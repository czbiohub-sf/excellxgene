import React from "react";
import * as d3 from "d3";
import { connect, shallowEqual } from "react-redux";
import { mat3, vec2 } from "gl-matrix";
import _regl from "regl";
import memoize from "memoize-one";
import Async from "react-async";
import { Button, Card, Elevation } from "@blueprintjs/core";
import { Popover2 } from "@blueprintjs/popover2";
import setupSVGandBrushElements from "./setupSVGandBrush";
import _camera from "../../util/camera";
import _drawPoints from "./drawPointsRegl";
import { Html2Canvas } from "../../html2canvasPruned";
import _ from "lodash";
import {
  createColorTable,
  createColorQuery,
} from "../../util/stateManager/colorHelpers";
import * as globals from "../../globals";

import GraphOverlayLayer from "./overlays/graphOverlayLayer";
import CentroidLabels from "./overlays/centroidLabels";
import actions from "../../actions";
import renderThrottle from "../../util/renderThrottle";

import {
  flagBackground,
  flagSelected,
  flagHighlight,
  flagHalfSelected,
  flagInvisible
} from "../../util/glHelpers";

function withinPolygon(polygon, x, y) {
  const n = polygon.length;
  let p = polygon[n - 1];
  let x0 = p[0];
  let y0 = p[1];
  let x1;
  let y1;
  let inside = false;

  for (let i = 0; i < n; i += 1) {
    p = polygon[i];
    x1 = p[0];
    y1 = p[1];

    if (y1 > y !== y0 > y && x < ((x0 - x1) * (y - y1)) / (y0 - y1) + x1)
      inside = !inside;
    x0 = x1;
    y0 = y1;
  }
  return inside;
}

/*
Simple 2D transforms control all point painting.  There are three:
  * model - convert from underlying per-point coordinate to a layout.
    Currently used to move from data to webgl coordinate system.
  * camera - apply a 2D camera transformation (pan, zoom)
  * projection - apply any transformation required for screen size and layout
*/
function createProjectionTF(viewportWidth, viewportHeight) {
  /*
  the projection transform accounts for the screen size & other layout
  */
  const fractionToUse = 0.95; // fraction of min dimension to use
  const topGutterSizePx = 32; // top gutter for tools
  const bottomGutterSizePx = 32; // bottom gutter for tools
  const heightMinusGutter =
    viewportHeight - topGutterSizePx - bottomGutterSizePx;
  const minDim = Math.min(viewportWidth, heightMinusGutter);
  const aspectScale = [
    (fractionToUse * minDim) / viewportWidth,
    (fractionToUse * minDim) / viewportHeight,
  ];
  const m = mat3.create();
  mat3.fromTranslation(m, [
    0,
    (bottomGutterSizePx - topGutterSizePx) / viewportHeight / aspectScale[1],
  ]);
  mat3.scale(m, m, aspectScale);
  return m;
}
function Float32Concat(first, second)
{
    var firstLength = first.length,
        result = new Float32Array(firstLength + second.length);

    result.set(first);
    result.set(second, firstLength);

    return result;
}
function createModelTF() {
  /*
  preallocate coordinate system transformation between data and gl.
  Data arrives in a [0,1] range, and we operate elsewhere in [-1,1].
  */
  const m = mat3.fromScaling(mat3.create(), [2, 2]);
  mat3.translate(m, m, [-0.5, -0.5]);
  return m;
}

@connect((state) => ({
  annoMatrix: state.annoMatrix,
  crossfilter: state.obsCrossfilter,
  selectionTool: state.graphSelection.tool,
  currentSelection: state.graphSelection.selection,
  layoutChoice: state.layoutChoice,
  graphInteractionMode: state.controls.graphInteractionMode,
  colors: state.colors,
  pointDilation: state.pointDilation,
  genesets: state.genesets.genesets,
  multiselect: state.graphSelection.multiselect,
  modifyingLayouts: state.controls.modifyingLayouts,
  screenCap: state.controls.screenCap,
  dataLayerExpr: state.reembedParameters.dataLayerExpr,
  logScaleExpr: state.reembedParameters.logScaleExpr,
  scaleExpr: state.reembedParameters.scaleExpr,
  pointScaler: state.controls.pointScaler,
  chromeKeyContinuous: state.controls.chromeKeyContinuous,
  chromeKeyCategorical: state.controls.chromeKeyCategorical,
  cxgMode: state.controls.cxgMode,
  allGenes: state.controls.allGenes.__columns[0],
  cOrG: state.controls.cxgMode === "OBS" ? "cell" : "gene",
  jointEmbeddingFlag: state.controls.jointEmbeddingFlag
}))
class Graph extends React.Component {
  static createReglState(canvas) {
    /*
    Must be created for each canvas
    */
    // setup canvas, webgl draw function and camera
    //canvas.getContext("webgl", {preserveDrawingBuffer: false});
    const camera = _camera(canvas);
    const regl = _regl(canvas);
    const drawPoints = _drawPoints(regl);

    // preallocate webgl buffers
    const pointBufferStart = regl.buffer();
    const pointBufferEnd = regl.buffer();
    const colorBuffer = regl.buffer();
    const flagBuffer = regl.buffer();
    return {
      camera,
      regl,
      drawPoints,
      pointBufferStart,
      pointBufferEnd,
      colorBuffer,
      flagBuffer,
    };
  }

  static watchAsync(props, prevProps) {
    return !shallowEqual(props.watchProps, prevProps.watchProps);
  }

  myRef = React.createRef();

  computePointPositions = memoize((X, Y, modelTF) => {
    const positions = new Float32Array(2 * X.length);
    for (let i = 0, len = X.length; i < len; i += 1) {
      const p = vec2.fromValues(X[i], Y[i]);
      vec2.transformMat3(p, p, modelTF);
      positions[2 * i] = p[0];
      positions[2 * i + 1] = p[1];
    }
    return positions;
  });

  computePointColors = memoize((rgb, nPoints) => {
    /*
    compute webgl colors for each point
    */
    const colors = new Float32Array(3 * nPoints);
    for (let i = 0, len = nPoints; i < len; i += 1) {
      colors.set(rgb[i], 3 * i);
    }
    return colors;
  });

  computeSelectedFlags = memoize(
    (crossfilter, colorMode, colorDf, _flagSelected, _flagHalfSelected, _flagUnselected ) => {
      const x = crossfilter.fillByIsSelected(
        new Float32Array(crossfilter.size()),
        _flagSelected,
        _flagUnselected
      );
      if (colorDf && colorMode !== "color by categorical metadata") {
        const col = colorDf.icol(0).asArray();
        for (let i = 0, len = x.length; i < len; i += 1) {
          if (col[i]<=0 && x[i] === _flagSelected){
            x[i] = _flagHalfSelected;
          }
        }
      }
      return x;
    }
  );

  computeHighlightFlags = memoize(
    (nObs, pointDilationData, pointDilationLabel) => {
      const flags = new Float32Array(nObs);
      if (pointDilationData) {
        for (let i = 0, len = flags.length; i < len; i += 1) {
          if (pointDilationData[i] === pointDilationLabel) {
            flags[i] = flagHighlight;
          }
        }
      }
      return flags;
    }
  );

  computeColorByFlags = memoize((nObs, colorByData) => {
    const flags = new Float32Array(nObs);
    if (colorByData) {
      for (let i = 0, len = flags.length; i < len; i += 1) {
        const val = colorByData[i];
        if (typeof val === "number" && !Number.isFinite(val)) {
          flags[i] = flagBackground;
        }
      }
    }
    return flags;
  });

  computePointFlags = memoize(
    (crossfilter, colorByData, colorMode, colorDf, pointDilationData, pointDilationLabel) => {
      /*
      We communicate with the shader using three flags:
      - isNaN -- the value is a NaN. Only makes sense when we have a colorAccessor
      - isSelected -- the value is selected
      - isHightlighted -- the value is highlighted in the UI (orthogonal from selection highlighting)

      Due to constraints in webgl vertex shader attributes, these are encoded in a float, "kinda"
      like bitmasks.

      We also have separate code paths for generating flags for categorical and
      continuous metadata, as they rely on different tests, and some of the flags
      (eg, isNaN) are meaningless in the face of categorical metadata.
      */
      const nObs = crossfilter.size();
      const flags = new Float32Array(nObs);

      const selectedFlags = this.computeSelectedFlags(
        crossfilter,
        colorMode,
        colorDf, 
        flagSelected,
        flagHalfSelected        
      );
      const highlightFlags = this.computeHighlightFlags(
        nObs,
        pointDilationData,
        pointDilationLabel
      );
      const colorByFlags = this.computeColorByFlags(nObs, colorByData);
      for (let i = 0; i < nObs; i += 1) {
        flags[i] = selectedFlags[i] + highlightFlags[i] + colorByFlags[i];
      }

      return flags;
    }
  );

  constructor(props) {
    super(props);
    this.init=false;
    const viewport = this.getViewportDimensions();
    this.reglCanvas = null;
    this.cachedAsyncProps = null;
    this.duration = 0;
    const modelTF = createModelTF();

    this.state = {
      toolSVG: null,
      tool: null,
      container: null,
      viewport,
      selectedOther: [],
      // projection
      camera: null,
      modelTF,
      modelInvTF: mat3.invert([], modelTF),
      projectionTF: createProjectionTF(viewport.width, viewport.height),
      renderedMetadata: (
        <Card interactive elevation={Elevation.TWO}>
          {`No ${props.cOrG}s in range.`}
        </Card>
      ),
      // regl state
      regl: null,
      drawPoints: null,
      pointBufferStart: null,
      pointBufferEnd: null,
      colorBuffer: null,
      flagBuffer: null,
      nPoints: null,

      // component rendering derived state - these must stay synchronized
      // with the reducer state they were generated from.
      layoutState: {
        layoutDf: null,
        layoutChoice: null,
      },
      colorState: {
        colors: null,
        colorDf: null,
        colorTable: null,
      },
      pointDilationState: {
        pointDilation: null,
        pointDilationDf: null,
      },
    };
  }

  componentDidMount() {
    window.addEventListener("resize", this.handleResize);
    this.myRef.current.addEventListener("wheel", this.handleLidarWheelEvent, {
      passive: false,
    });
  }

  componentDidUpdate(prevProps, prevState) {
    const {
      selectionTool,
      currentSelection,
      graphInteractionMode,
      dataLayerExpr,
      logScaleExpr,
      scaleExpr,
      pointScaler,
      layoutChoice
    } = this.props;
    const { toolSVG, viewport, regl } = this.state;
    const hasResized =
      prevState.viewport.height !== viewport.height ||
      prevState.viewport.width !== viewport.width;// || graphWidth !== prevProps.graphWidth;
    let stateChanges = {};
    if (
      (viewport.height && viewport.width && !toolSVG) || // first time init
      hasResized || //  window size has changed we want to recreate all SVGs
      selectionTool !== prevProps.selectionTool || // change of selection tool
      prevProps.graphInteractionMode !== graphInteractionMode  ||// lasso/zoom mode is switched
      prevProps.dataLayerExpr !== dataLayerExpr ||
      prevProps.logScaleExpr !== logScaleExpr ||
      prevProps.scaleExpr !== scaleExpr
    ) {
      stateChanges = {
        ...stateChanges,
        ...this.createToolSVG(),
      };
    }

    if (pointScaler !== prevProps.pointScaler && regl) {
      const drawPoints = _drawPoints(regl, pointScaler)
      stateChanges = {...stateChanges, drawPoints}
    }
    /*
    if the selection tool or state has changed, ensure that the selection
    tool correctly reflects the underlying selection.
    */
    if (
      currentSelection !== prevProps.currentSelection ||
      graphInteractionMode !== prevProps.graphInteractionMode ||
      stateChanges.toolSVG
    ) {
      const { tool, container } = this.state;
      this.selectionToolUpdate(
        stateChanges.tool ? stateChanges.tool : tool,
        stateChanges.container ? stateChanges.container : container
      );
    }
    if (layoutChoice.current !== prevProps.layoutChoice.current) {
      stateChanges = {...stateChanges, selectedOther: []}
    }
    if (Object.keys(stateChanges).length > 0) {
      // eslint-disable-next-line react/no-did-update-set-state --- Preventing update loop via stateChanges and diff checks
      this.setState(stateChanges);
    }
  }

  componentWillUnmount() {
    window.removeEventListener("resize", this.handleResize);
    this.myRef.current.removeEventListener(
      "wheel",
      this.handleLidarWheelEvent,
      { passive: false }
    );
  }

  handleResize = () => {
    const { state } = this.state;
    const viewport = this.getViewportDimensions();
    const projectionTF = createProjectionTF(viewport.width, viewport.height);
    this.setState({
      ...state,
      viewport,
      projectionTF,
    });
  };

  handleCanvasEvent = (e) => {
    const { camera, projectionTF } = this.state;
    if (e.type !== "wheel") e.preventDefault();
    if (camera.handleEvent(e, projectionTF)) {
      this.duration = 0;
      this.renderCanvas();
      this.setState((state) => {
        return { ...state, updateOverlay: !state.updateOverlay };
      });
    }
  };

  handleLidarWheelEvent = (e) => {
    const { graphInteractionMode } = this.props;
    if (graphInteractionMode === "lidar") {
      const { lidarRadius } = this.state;
      e.preventDefault();
      const offset = e.deltaY < 0 ? -1.5 : 1.5;

      const radius = (lidarRadius ?? 20) + offset;
      this.setState((state) => {
        return { ...state, lidarRadius: radius < 10 ? 10 : radius };
      });
    }
  };

  handleLidarEvent = (e) => {
    if (e.type === "mousemove") {
      if (e.target.id === "lidar-layer") {
        this.setState((state) => {
          return { ...state, lidarFocused: true };
        });
      }
      const rect = e.target.getBoundingClientRect();
      const screenX = e.pageX - rect.left;
      const screenY = e.pageY - rect.top;
      const point = this.mapScreenToPoint([screenX, screenY]);
      this.setState((state) => {
        return {
          ...state,
          screenX,
          screenY,
          pointX: point[0],
          pointY: point[1],
        };
      });
    } else if(e.type === "mousedown") {

      this.fetchLidarCrossfilter();
      
    } else if (e.type === "mouseleave") {
      this.setState((state) => {
        return { ...state, lidarFocused: false, renderedMetadata: (
          <Card interactive elevation={Elevation.TWO}>
            {`No ${this.props.cOrG}s in range.`}
          </Card>
        )};
      });
    }
  };

  handleBrushDragAction() {
    /*
      event describing brush position:
      @-------|
      |       |
      |       |
      |-------@
    */
    // ignore programatically generated events
    if (d3.event.sourceEvent === null || !d3.event.selection) return;

    const { dispatch, layoutChoice } = this.props;
    const s = d3.event.selection;
    const northwest = this.mapScreenToPoint(s[0]);
    const southeast = this.mapScreenToPoint(s[1]);
    const [minX, maxY] = northwest;
    const [maxX, minY] = southeast;
    dispatch(
      actions.graphBrushChangeAction(layoutChoice.current, {
        minX,
        minY,
        maxX,
        maxY,
        northwest,
        southeast,
      })
    );
  }

  handleBrushStartAction() {
    // Ignore programatically generated events.
    if (!d3.event.sourceEvent) return;

    const { dispatch } = this.props;
    dispatch(actions.graphBrushStartAction());
  }

  handleBrushEndAction() {
    // Ignore programatically generated events.
    if (!d3.event.sourceEvent) return;

    /*
    coordinates will be included if selection made, null
    if selection cleared.
    */
    const { dispatch, layoutChoice } = this.props;
    const s = d3.event.selection;
    if (s) {
      const northwest = this.mapScreenToPoint(s[0]);
      const southeast = this.mapScreenToPoint(s[1]);
      const [minX, maxY] = northwest;
      const [maxX, minY] = southeast;
      dispatch(
        actions.graphBrushEndAction(layoutChoice.current, {
          minX,
          minY,
          maxX,
          maxY,
          northwest,
          southeast,
        })
      );
    } else {
      dispatch(actions.graphBrushDeselectAction(layoutChoice.current));
    }
  }

  handleBrushDeselectAction() {
    const { dispatch, layoutChoice } = this.props;
    dispatch(actions.graphBrushDeselectAction(layoutChoice.current));
  }

  handleLassoStart() {
    const { dispatch, layoutChoice } = this.props;
    dispatch(actions.graphLassoStartAction(layoutChoice.current));
  }

  polygonBoundingBox = (polygon) => {
    let minX = Number.MAX_VALUE;
    let minY = Number.MAX_VALUE;
    let maxX = Number.MIN_VALUE;
    let maxY = Number.MIN_VALUE;
    for (let i = 0, l = polygon.length; i < l; i += 1) {
      const point = polygon[i];
      const [x, y] = point;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    return [minX, minY, maxX, maxY];
  }
  selectWithinPolygon(polygon,multiselect) {
    const { selectedOther } = this.state;
    const { dispatch, allGenes } = this.props;
    const [minX, minY, maxX, maxY] = this.polygonBoundingBox(polygon);
    const { positions2: positions } = this.state;
    const [X,Y] = positions;
    const I = [];
    let i = 0;
    for (let z = 0; z < X.length; z+=1) {
      const x = X[z]
      const y = Y[z]
      if (!(x < minX || x > maxX || y < minY || y > maxY)) {
        if (withinPolygon(polygon,x,y)){
          I.push(i)
        }
      }
      i+=1;
    }
    if (multiselect) {
      this.setState({selectedOther: [...new Set([...I, ...(selectedOther ?? [])])]})
      const I2 = [...new Set([...I, ...(selectedOther ?? [])])]
      dispatch({type: "set other mode selection", selectedIndices: I2, selected: I2.map((item)=>allGenes[item])})        

    } else {
      this.setState({selectedOther: I})
      dispatch({type: "set other mode selection", selectedIndices: I, selected: I.map((item)=>allGenes[item])})        

    }
  }

  // when a lasso is completed, filter to the points within the lasso polygon
  handleLassoEnd(polygon) {
    const minimumPolygonArea = 10;
    const { dispatch, layoutChoice, multiselect } = this.props;
    const { positions2: positions } = this.state;
    if (
      polygon.length < 3 ||
      Math.abs(d3.polygonArea(polygon)) < minimumPolygonArea
    ) {
      // if less than three points, or super small area, treat as a clear selection.
      dispatch(actions.graphLassoDeselectAction(layoutChoice.current));
      this.setState({selectedOther: []})
      dispatch({type: "set other mode selection", selectedIndices: this.state.defaultSelectedOther ?? [], selected: []})    
    } else {
        if (positions) {
          this.selectWithinPolygon(polygon.map((xy) => this.mapScreenToPoint(xy)), multiselect)
        }      
      dispatch(
        actions.graphLassoEndAction(
          layoutChoice.current,
          polygon.map((xy) => this.mapScreenToPoint(xy)),
          multiselect
        )
      );
    }
  }

  handleLassoCancel() {
    const { dispatch, layoutChoice } = this.props;
    dispatch(actions.graphLassoCancelAction(layoutChoice.current));
  }

  handleLassoDeselectAction() {
    const { dispatch, layoutChoice } = this.props;
    dispatch(actions.graphLassoDeselectAction(layoutChoice.current));
  }

  handleDeselectAction() {
    const { selectionTool } = this.props;
    if (selectionTool === "brush") this.handleBrushDeselectAction();
    if (selectionTool === "lasso") this.handleLassoDeselectAction();
  }

  handleOpacityRangeChange(e) {
    const { dispatch } = this.props;
    dispatch({
      type: "change opacity deselected cells in 2d graph background",
      data: e.target.value,
    });
  }

  setReglCanvas = (canvas) => {
    this.reglCanvas = canvas;
    this.setState({
      ...Graph.createReglState(canvas),
    });
  };

  getViewportDimensions = () => {
    const { viewportRef } = this.props;
    return {
      height: viewportRef.clientHeight,
      width: viewportRef.clientWidth,
    };
  };

  createToolSVG = () => {
    /*
    Called from componentDidUpdate. Create the tool SVG, and return any
    state changes that should be passed to setState().
    */
    const { selectionTool, graphInteractionMode } = this.props;
    const { viewport } = this.state;

    /* clear out whatever was on the div, even if nothing, but usually the brushes etc */
    const lasso = d3.select("#lasso-layer");

    const lidar = d3.select("#lidar-layer");
    if (!lidar.empty()) {
      lidar.selectAll(".lidar-group").remove();
    }
    if (lasso.empty()) return {}; // still initializing
    lasso.selectAll(".lasso-group").remove();

    // Don't render or recreate toolSVG if currently in zoom mode
    if (graphInteractionMode !== "select" && graphInteractionMode !== "lidar") {
      // don't return "change" of state unless we are really changing it!
      const { toolSVG } = this.state;
      if (toolSVG === undefined) return {};
      return { toolSVG: undefined };
    }

    let handleStart;
    let handleDrag;
    let handleEnd;
    let handleCancel;
    if (selectionTool === "brush") {
      handleStart = this.handleBrushStartAction.bind(this);
      handleDrag = this.handleBrushDragAction.bind(this);
      handleEnd = this.handleBrushEndAction.bind(this);
    } else {
      handleStart = this.handleLassoStart.bind(this);
      handleEnd = this.handleLassoEnd.bind(this);
      handleCancel = this.handleLassoCancel.bind(this);
    }

    const { svg: newToolSVG, tool, container } = setupSVGandBrushElements(
      selectionTool,
      handleStart,
      handleDrag,
      handleEnd,
      handleCancel,
      viewport
    );

    return { toolSVG: newToolSVG, tool, container };
  };

  fetchAsyncProps = async (props) => {
    const {
      annoMatrix,
      colors: colorsProp,
      layoutChoice,
      crossfilter,
      pointDilation,
      viewport,
      modifyingLayouts,
      screenCap,
      pointScaler,
      chromeKeyCategorical,
      chromeKeyContinuous,
      selectedOther,
      jointEmbeddingFlag
    } = props.watchProps;
    if (!(modifyingLayouts)){
      this.init = true;
      const { modelTF } = this.state;
      const [layoutDf, layoutDf2, colorDf, pointDilationDf] = await this.fetchData(
        annoMatrix,
        layoutChoice,
        colorsProp,
        pointDilation
      );
      const doJointLayout = !(layoutDf2.__columns[0][0]===0.5 && layoutDf2.__columns[0][1]===0.5 &&
          layoutDf2.__columns[1][0]===0.5 && layoutDf2.__columns[1][1]===0.5);

      if (this.props.layoutChoice.current !== layoutChoice.current) {
        return this.cachedAsyncProps;
      }
      
      const { currentDimNames } = layoutChoice;
      
      const X = layoutDf.col(currentDimNames[0]).asArray();
      const Y = layoutDf.col(currentDimNames[1]).asArray();

      let positions = this.computePointPositions(X, Y, modelTF);
      const colorTable = this.updateColorTable(colorsProp, colorDf);
      let colors = this.computePointColors(colorTable.rgb, annoMatrix.nObs);

      const { colorAccessor } = colorsProp;
      const colorByData = colorDf?.col(colorAccessor)?.asArray();

      const {
        metadataField: pointDilationCategory,
        categoryField: pointDilationLabel,
      } = pointDilation;
      const pointDilationData = pointDilationDf
        ?.col(pointDilationCategory)
        ?.asArray();

      let flags = this.computePointFlags(
        crossfilter,
        colorByData,
        colorsProp.colorMode,
        colorDf,
        pointDilationData,
        pointDilationLabel
      );

      const { width, height } = viewport;
      let nPoints = annoMatrix.nObs;
      if (doJointLayout) {
        const X2 = layoutDf2.col(currentDimNames[0]).asArray();
        const Y2 = layoutDf2.col(currentDimNames[1]).asArray();
        const def = [];
        X2.forEach((item,ix)=>{
          if (item) def.push(ix)
        })
        const positions2 = this.computePointPositions(X2, Y2, modelTF);
        this.setState({...this.state, positions2: [X2,Y2]})
        positions = Float32Concat(positions,positions2);

        const flags2 = new Float32Array(layoutDf2.length)
        flags2.forEach((_item,index)=>{
          if (selectedOther.length === 0) {
            flags2[index] = colorsProp.colorAccessor ? null : flagHalfSelected;
          } else {
            flags2[index] = null;
          }
          if (!jointEmbeddingFlag) {
            flags2[index] = flagInvisible;
          }
        })
        selectedOther.forEach((item)=>{
          flags2[item] = flagHalfSelected
          if (!jointEmbeddingFlag) {
            flags2[item] = flagInvisible;
          }          
        })
        flags = Float32Concat(flags,flags2)
        
        const { cxgMode } = this.props;
        const colors2 = new Float32Array(3 * layoutDf2.length);
        for (let i = 0, len = layoutDf2.length; i < len; i += 1) {
          if (cxgMode === "OBS") {
            if (!flags2[i]) {
              colors2.set([0.5,0,0], 3 * i);
            } else {
              colors2.set([1,0,0], 3 * i);
            }
          } else {
            if (!flags2[i]) {
              colors2.set([0,0,0.5], 3 * i);
            } else {
              colors2.set([0,0,1], 3 * i);
            }          } 
        }
        colors = Float32Concat(colors,colors2) 
        nPoints = nPoints + annoMatrix.nVar;       
        this.setState({defaultSelectedOther: def})
      }
      this.setState((state) => {
        return { ...state, colorState: { colors, colorDf, colorTable }, nPoints: nPoints };
      });
      this.init = false;
      return {
        positions,
        colors,
        flags,
        width,
        height,
        screenCap,
        pointScaler,
        chromeKeyCategorical,
        chromeKeyContinuous,
        jointEmbeddingFlag,
        layoutChoice,
        layoutDf
      };
    } else {
      return this.cachedAsyncProps;
    }
  };

  async fetchData(annoMatrix, layoutChoice, colors, pointDilation) {
    /*
    fetch all data needed.  Includes:
      - the color by dataframe
      - the layout dataframe
      - the point dilation dataframe
    */
    const { metadataField: pointDilationAccessor } = pointDilation;

    const promises = [];
    // layout 
    promises.push(annoMatrix.fetch("emb", layoutChoice.current));
    promises.push(annoMatrix.fetch("jemb", layoutChoice.current))
    // color
    const query = this.createColorByQuery(colors);
    if (query) {
      promises.push(annoMatrix.fetch(...query));
    } else {
      promises.push(Promise.resolve(null));
    }

    // point highlighting
    if (pointDilationAccessor) {
      promises.push(annoMatrix.fetch("obs", pointDilationAccessor));
    } else {
      promises.push(Promise.resolve(null));
    }
    return Promise.all(promises);
  }

  fetchLidarCrossfilter() {
    const { lidarRadius, pointX, pointY, screenX, screenY } = this.state;
    const { crossfilter, layoutChoice } = this.props;

    const dummyPoint = this.mapScreenToPoint([
      screenX - (lidarRadius ?? 20),
      screenY,
    ]);
    const radius = Math.sqrt(
      (dummyPoint[0] - pointX) ** 2 + (dummyPoint[1] - pointY) ** 2
    );
    const selection = {
      mode: "within-lidar",
      center: [pointX, pointY],
      radius,
    };
    crossfilter.select("emb", layoutChoice.current, selection).then((cf) => {
      let count = 0;
      if (cf) {
        const dim =
          cf.obsCrossfilter.dimensions[
            `emb/${layoutChoice.current}_0:${layoutChoice.current}_1`
          ];
        if (!dim) {
          return;
        }
        const { ranges } = dim.selection;
        ranges.forEach((range) => {
          count += range[1] - range[0];
        });
      }
      this.setState((state) => {
        return { ...state, numCellsInLidar: count, lidarCrossfilter: cf };
      });

      const metadata = this.renderMetadata()
      this.setState((state) => {
        return { ...state, renderedMetadata: metadata };
      });

    });
  }

  brushToolUpdate(tool, container) {
    /*
    this is called from componentDidUpdate(), so be very careful using
    anything from this.state, which may be updated asynchronously.
    */
    const { currentSelection } = this.props;
    if (container) {
      const toolCurrentSelection = d3.brushSelection(container.node());

      if (currentSelection.mode === "within-rect") {
        /*
        if there is a selection, make sure the brush tool matches
        */
        const screenCoords = [
          this.mapPointToScreen(currentSelection.brushCoords.northwest),
          this.mapPointToScreen(currentSelection.brushCoords.southeast),
        ];
        if (!toolCurrentSelection) {
          /* tool is not selected, so just move the brush */
          container.call(tool.move, screenCoords);
        } else {
          /* there is an active selection and a brush - make sure they match */
          /* this just sums the difference of each dimension, of each point */
          let delta = 0;
          for (let x = 0; x < 2; x += 1) {
            for (let y = 0; y < 2; y += 1) {
              delta += Math.abs(
                screenCoords[x][y] - toolCurrentSelection[x][y]
              );
            }
          }
          if (delta > 0) {
            container.call(tool.move, screenCoords);
          }
        }
      } else if (toolCurrentSelection) {
        /* no selection, so clear the brush tool if it is set */
        container.call(tool.move, null);
      }
    }
  }

  lassoToolUpdate(tool) {
    /*
    this is called from componentDidUpdate(), so be very careful using
    anything from this.state, which may be updated asynchronously.
    */
    const { currentSelection } = this.props;
    if (currentSelection.mode === "within-polygon") {
      /*
      if there is a current selection, make sure the lasso tool matches
      */
      const polygon = currentSelection.polygon.map((p) =>
        this.mapPointToScreen(p)
      );
      tool.move(polygon);
    } else {
      tool.reset();
    }
  }

  selectionToolUpdate(tool, container) {
    /*
    this is called from componentDidUpdate(), so be very careful using
    anything from this.state, which may be updated asynchronously.
    */
    const { selectionTool } = this.props;
    switch (selectionTool) {
      case "brush":
        this.brushToolUpdate(tool, container);
        break;
      case "lasso":
        this.lassoToolUpdate(tool, container);
        break;
      default:
        /* punt? */
        break;
    }
  }

  mapScreenToPoint(pin) {
    /*
    Map an XY coordinates from screen domain to cell/point range,
    accounting for current pan/zoom camera.
    */

    const { camera, projectionTF, modelInvTF, viewport } = this.state;
    const cameraInvTF = camera.invView();

    /* screen -> gl */
    const x = (2 * pin[0]) / viewport.width - 1;
    const y = 2 * (1 - pin[1] / viewport.height) - 1;

    const xy = vec2.fromValues(x, y);
    const projectionInvTF = mat3.invert(mat3.create(), projectionTF);
    vec2.transformMat3(xy, xy, projectionInvTF);
    vec2.transformMat3(xy, xy, cameraInvTF);
    vec2.transformMat3(xy, xy, modelInvTF);
    return xy;
  }

  mapPointToScreen(xyCell) {
    /*
    Map an XY coordinate from cell/point domain to screen range.  Inverse
    of mapScreenToPoint()
    */

    const { camera, projectionTF, modelTF, viewport } = this.state;
    const cameraTF = camera.view();

    const xy = vec2.transformMat3(vec2.create(), xyCell, modelTF);
    vec2.transformMat3(xy, xy, cameraTF);
    vec2.transformMat3(xy, xy, projectionTF);

    return [
      Math.round(((xy[0] + 1) * viewport.width) / 2),
      Math.round(-((xy[1] + 1) / 2 - 1) * viewport.height),
    ];
  }

  renderCanvas = renderThrottle(() => {
    const {
      regl,
      drawPoints,
      colorBuffer,
      pointBufferStart,
      pointBufferEnd,
      flagBuffer,
      camera,
      projectionTF,
      nPoints
    } = this.state;
    const { screenCap } = this.props;
    this.renderPoints(
      regl,
      drawPoints,
      colorBuffer,
      pointBufferStart,
      pointBufferEnd,
      this.duration,
      flagBuffer,
      camera,
      projectionTF,
      screenCap,
      nPoints
    );
  });

  shouldComponentUpdate = (nextProps, nextState) => {
    const currprops = this.props;
    const newprops = nextProps;
    return (!shallowEqual(currprops,newprops) || 
            this.state.viewport !== nextState.viewport || 
            this.state.renderedMetadata !== nextState.renderedMetadata ||
            this.state.pointX !== nextState.pointX ||
            this.state.pointY !== nextState.pointY ||
            this.state.lidarCrossfilter !== nextState.lidarCrossfilter ||
            this.state.lidarRadius !== nextState.lidarRadius ||
            this.state.lidarFocused !== nextState.lidarFocused
          );
  }

  updateReglAndRender(asyncProps, prevAsyncProps) {
    const { positions: positionsEnd, colors, flags, height, width, screenCap, pointScaler, chromeKeyCategorical, chromeKeyContinuous, jointEmbeddingFlag, layoutChoice } = asyncProps;
    const positionsStart = prevAsyncProps?.positions ?? positionsEnd;
    const prevLayoutChoice = prevAsyncProps?.layoutChoice;
    this.duration = (layoutChoice.current !== prevLayoutChoice?.current) && prevAsyncProps?.positions ? globals.animationLength : 0;
    this.cachedAsyncProps = asyncProps;
    
    const { pointBufferStart, pointBufferEnd, colorBuffer, flagBuffer } = this.state;
    let needToRenderCanvas = false;

    if (height !== prevAsyncProps?.height || width !== prevAsyncProps?.width) {
      needToRenderCanvas = true;
    }
    if (positionsEnd !== prevAsyncProps?.positions) {

      const newPos = positionsEnd;
      const pos2 = positionsStart;
      
      const oldIndices = prevAsyncProps?.layoutDf?.rowIndex?.rindex ?? null;
      const newIndices = asyncProps?.layoutDf?.rowIndex?.rindex ?? null;
    
      let oldPos;
      if (oldIndices && !newIndices) { 
        oldPos = [...newPos]; 
        for (let i = 0; i < oldIndices.length; i +=1 ) { 
          const x = 2*oldIndices[i]
          const y = 2*oldIndices[i]+1
          oldPos[x] = pos2[2*i]
          oldPos[y] = pos2[2*i+1]
        }
      } else if (!oldIndices && newIndices) { 
        oldPos = [];
        for (let i = 0; i < newIndices.length; i +=1 ) {
          const x = 2*newIndices[i]
          const y = 2*newIndices[i]+1
          oldPos.push(pos2[x])
          oldPos.push(pos2[y])
        }
      } else {
        oldPos = pos2;
      }   

      pointBufferStart({ data: oldPos, dimension: 2 });
      pointBufferEnd({ data: newPos, dimension: 2 });
      needToRenderCanvas = true;
    }
    if (colors !== prevAsyncProps?.colors) {
      colorBuffer({ data: colors, dimension: 3 });
      needToRenderCanvas = true;
    }
    if (flags !== prevAsyncProps?.flags) {
      flagBuffer({ data: flags, dimension: 1 });
      needToRenderCanvas = true;
    }
    if (screenCap !== prevAsyncProps?.screenCap && screenCap) {
      needToRenderCanvas = true;
    } 
    if (pointScaler !== prevAsyncProps?.pointScaler) {
      needToRenderCanvas = true;
    }
    if (chromeKeyCategorical !== prevAsyncProps?.chromeKeyCategorical) {
      needToRenderCanvas = true;
    }
    if (chromeKeyContinuous !== prevAsyncProps?.chromeKeyContinuous) {
      needToRenderCanvas = true;
    }    
    if (jointEmbeddingFlag !== prevAsyncProps?.jointEmbeddingFlag) {
      needToRenderCanvas = true;
    }        
    if (needToRenderCanvas){
      this.renderCanvas();
    }
  }

  updateColorTable(colors, colorDf) {
    const { annoMatrix, chromeKeyCategorical, chromeKeyContinuous } = this.props;
    const { schema } = annoMatrix;

    /* update color table state */
    if (!colors || !colorDf) {
      return createColorTable(
        null, // default mode
        null,
        null,
        schema,
        chromeKeyCategorical,
        chromeKeyContinuous,
        null
      );
    }

    const { colorAccessor, userColors, colorMode } = colors;
    return createColorTable(
      colorMode,
      colorAccessor,
      colorDf,
      schema,
      chromeKeyCategorical,
      chromeKeyContinuous,      
      userColors
    );
  }

  createColorByQuery(colors) {
    const { annoMatrix, genesets } = this.props;
    const { schema } = annoMatrix;
    const { colorMode, colorAccessor } = colors;
    return createColorQuery(colorMode, colorAccessor, schema, genesets);
  }

  renderMetadata() {
    const { annoMatrix, colors, cOrG } = this.props;
    const { colorState, lidarCrossfilter, numCellsInLidar } = this.state;
    
    if (colors.colorMode && colorState.colorDf) {
      const { colorDf: colorData, colorTable } = colorState;
      const { colorAccessor, colorMode } = colors;
      if (colorMode === "color by categorical metadata" && lidarCrossfilter) {
        const arr = new Array(annoMatrix.nObs);
        lidarCrossfilter.fillByIsSelected(arr, 1, 0);
        let df;
        try {
          df = colorData.withCol("New", arr);
        } catch (e) {
          return (
            <Card interactive elevation={Elevation.TWO}>
              {`Hovering over ${numCellsInLidar ?? 0} ${cOrG}s.`}
            </Card>
          );
        }

        const dfcol = df.col(colorAccessor);
        let els;
        let nums;
        if (dfcol) {
          const { categories, categoryCounts } = dfcol.summarizeCategorical();
          const groupBy = df.col("New");
          const occupancyMap = df
            .col(colorAccessor)
            .histogramCategorical(groupBy);
          const occupancy = occupancyMap.get(1);
          const colorDict = {};
          colorData
            .col(colorAccessor)
            .asArray()
            .forEach((val, index) => {
              colorDict[val] = colorTable.rgb[index];
            });
          if (occupancy) {
            els = [];
            nums = [];
            for (const key of categories) {
              if (occupancy.get(key)) {
                const c = colorDict[key];
                const color = c
                  ? `rgb(${c.map((x) => (x * 255).toFixed(0))})`
                  : "black";
                const num = occupancy.get(key, 0) ?? 0
                nums.push(parseInt(num))
                els.push(
                  <div
                    key={key}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      flexDirection: "row",
                    }}
                  >
                    <strong
                      style={{
                        color: `${color}`,
                      }}
                    >
                      {key?.toString()?.concat(" ")}
                    </strong>
                    <div style={{ paddingLeft: "10px" }}>
                      {`${num} / ${
                        categoryCounts.get(key) ?? 0
                      }`}
                    </div>
                  </div>
                );
              }
            }
            const dsu = (arr1, arr2) => arr1
                          .map((item, index) => [arr2[index], item]) 
                          .sort(([arg1], [arg2]) => arg2 - arg1) 
                          .map(([, item]) => item); 
            
            els = dsu(els, nums);

          }
        }

        return (
          <Card interactive elevation={Elevation.TWO}>
            {els ?? `No ${this.props.cOrG}s in range`}
          </Card>
        );
      }
      if (lidarCrossfilter) {
        const arr = new Array(annoMatrix.nObs);
        lidarCrossfilter.fillByIsSelected(arr, 1, 0);
        const col = colorData.col(colorData.colIndex.rindex[0]).asArray();
        const subsetArray = [];
        for (let i = 0; i < arr.length; i += 1) {
          if (arr[i]) {
            subsetArray.push(col[i]);
          }
        }
        let mean;
        let std;
        if (subsetArray.length > 0) {
          const n = subsetArray.length;
          mean = subsetArray.reduce((a, b) => a + b) / n;
          std = Math.sqrt(
            subsetArray.map((x) => (x - mean) ** 2).reduce((a, b) => a + b) / n
          );
        } else {
          mean = 0;
          std = 0;
        }
        return (
          <Card interactive elevation={Elevation.TWO}>
            <div style={{ paddingBottom: "10px" }}>
              <strong>{colorAccessor.split('//;;//').join("")}</strong>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                flexDirection: "row",
              }}
            >
              <div>
                <strong>Mean</strong>
              </div>
              <div style={{ paddingLeft: "10px" }}>
                <strong>Std. Dev.</strong>
              </div>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                flexDirection: "row",
              }}
            >
              <div>{mean.toFixed(3)}</div>
              <div style={{ paddingLeft: "10px" }}>{std.toFixed(3)}</div>
            </div>
          </Card>
        );
      }
    }
    return (
      <Card interactive elevation={Elevation.TWO}>
        {`Hovering over ${numCellsInLidar ?? 0} ${this.props.cOrG}s.`}
      </Card>
    );
  }

  async renderPoints(
    regl,
    drawPoints,
    colorBuffer,
    pointBufferStart,
    pointBufferEnd,
    duration,
    flagBuffer,
    camera,
    projectionTF,
    screenCap,
    nPoints
  ) {
    const { annoMatrix, dispatch, layoutChoice, pointScaler, allGenes } = this.props;
    if (!this.reglCanvas || !annoMatrix) return;

    const cameraTF = camera.view();
    const projView = mat3.multiply(mat3.create(), projectionTF, cameraTF);
    const { width, height } = this.reglCanvas;

    let startTime;
    const frameLoop = regl.frame(async ({ time }) => {
      if (!startTime) {
        startTime = time;
      }
      regl.clear({
        depth: 1,
        color: [1, 1, 1, 1],
      });      
      drawPoints({
        distance: camera.distance(),
        color: colorBuffer,
        positionsStart: pointBufferStart,
        positionsEnd: pointBufferEnd,
        flag: flagBuffer,
        count: nPoints,
        projView,
        nPoints: nPoints,
        minViewportDimension: Math.min(width, height),
        duration,
        startTime
      }, pointScaler
      );
      
      if (time - startTime > duration / 1000) {
        frameLoop.cancel();
        if (screenCap) {  
          const graph = regl._gl.canvas;//document.getElementById("embedding-layout");
          const legend = document.getElementById("continuous_legend");
          const canvas = new OffscreenCanvas(width, height);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(graph, 0, 0);
          const H2C = new Html2Canvas();
          const canvas_new = await H2C.h2c.html2canvas(legend);      
          try {
            ctx.drawImage(canvas_new, 0, 0);
          } catch {}
          
          const blob = await canvas.convertToBlob();
          var a = document.createElement("a");      
          document.body.appendChild(a);
          a.style = "display: none";
          var url = window.URL.createObjectURL(blob);
          a.href = url;
          a.download = `${layoutChoice.current.split(';;').at(-1)}_emb.png`;
          a.click();
          window.URL.revokeObjectURL(url); 
          dispatch({type: "graph: screencap end"}) 
        }         
      }      
    })  
    
    regl._gl.flush();
    if (nPoints <= annoMatrix.nObs) {
      this.setState({...this.state,positions2: null, selectedOther: []})
      dispatch({type: "set other mode selection", selectedIndices: [], selected: []})  
    } else {
      if (this.state.selectedOther.length === 0) { // revert indices to default selection.
        dispatch({type: "set other mode selection", selectedIndices: this.state.defaultSelectedOther ?? [], selected: this.state.selectedOther.map((item)=>allGenes[item]) ?? []})  
      }
    }
    
  }

  render() {
    const {
      graphInteractionMode,
      annoMatrix,
      colors,
      layoutChoice,
      pointDilation,
      crossfilter,
      sankeyPlotMode,
      modifyingLayouts,
      screenCap,
      dataLayerExpr,
      logScaleExpr,
      scaleExpr,
      pointScaler,
      chromeKeyCategorical,
      chromeKeyContinuous,
      jointEmbeddingFlag
    } = this.props;
    const {
      modelTF,
      lidarFocused,
      screenX,
      screenY,
      projectionTF,
      camera,
      viewport,
      regl,
      lidarRadius,
      renderedMetadata,
      selectedOther
    } = this.state;
    const radius = lidarRadius ?? 20;
    const cameraTF = camera?.view()?.slice();
    return (
      <div
        id="graph-wrapper"
        style={{
          position: "relative",
          top: 0,
          left: 0,
          display: sankeyPlotMode ? "none" : "inherit",
        }}
        ref={this.myRef}
      >
        <GraphOverlayLayer
          width={viewport.width}
          height={viewport.height}
          cameraTF={cameraTF}
          modelTF={modelTF}
          projectionTF={projectionTF}
          handleCanvasEvent={
            graphInteractionMode === "zoom" ? this.handleCanvasEvent : undefined
          }
        >
          <CentroidLabels />
        </GraphOverlayLayer>
        <svg
          id="lasso-layer"
          data-testid="layout-overlay"
          className={`graph-svg`}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            zIndex: 1,
          }}
          width={viewport.width}
          height={viewport.height}
          pointerEvents={graphInteractionMode === "select" ? "auto" : "none"}
        />
        <Popover2
          placement="top-left"
          minimal
          content={renderedMetadata}
          isOpen={graphInteractionMode === "lidar" && lidarFocused}
        >
          <svg
            id="lidar-layer"
            className={`graph-svg`}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              zIndex: 2,
            }}
            width={viewport.width}
            height={viewport.height}
            pointerEvents={graphInteractionMode === "lidar" ? "auto" : "none"}
            onMouseDown={this.handleLidarEvent}
            onMouseUp={this.handleLidarEvent}
            onMouseMove={this.handleLidarEvent}
            onMouseLeave={this.handleLidarEvent}
            onDoubleClick={this.handleLidarEvent}
          />
        </Popover2>
        <canvas
          width={viewport.width}
          height={viewport.height}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            padding: 0,
            margin: 0,
            shapeRendering: "crispEdges",
          }}
          className={`graph-canvas`}
          id="embedding-layout"
          data-testid="layout-graph"
          ref={this.setReglCanvas}
          onMouseDown={this.handleCanvasEvent}
          onMouseUp={this.handleCanvasEvent}
          onMouseMove={this.handleCanvasEvent}
          onDoubleClick={this.handleCanvasEvent}
          onWheel={this.handleCanvasEvent}
        />

        {graphInteractionMode === "lidar" && lidarFocused ? (
          <div
            style={{
              position: "absolute",
              left: `${screenX - radius}px`,
              top: `${screenY - radius}px`,
              width: `${radius * 2}px`,
              height: `${radius * 2}px`,
              borderColor: "black",
              borderWidth: "0.1px",
              borderStyle: "solid",
              borderRadius: "50%",
              paddingLeft: `${radius / 2}px`,
              paddingTop: `${radius / 2}px`,
            }}
          />
        ) : null}
        <Async
          watchFn={Graph.watchAsync}
          promiseFn={this.fetchAsyncProps}
          watchProps={{
            annoMatrix,
            colors,
            layoutChoice,
            pointDilation,
            crossfilter,
            viewport,
            modifyingLayouts,
            screenCap,
            dataLayerExpr,
            logScaleExpr,
            scaleExpr,
            pointScaler,
            chromeKeyCategorical,
            chromeKeyContinuous,
            selectedOther,
            jointEmbeddingFlag
          }}
        >
          <Async.Pending initial>
            <StillLoading
              displayName={layoutChoice.current}
              width={viewport.width}
              height={viewport.height}
            />
          </Async.Pending>
          <Async.Rejected>
            {(error) => (
              <ErrorLoading
                displayName={layoutChoice.current}
                error={error}
                width={viewport.width}
                height={viewport.height}
              />
            )}
          </Async.Rejected>
          <Async.Fulfilled>
            {(asyncProps) => {
              
              if (regl && !shallowEqual(asyncProps, this.cachedAsyncProps)) {
                this.updateReglAndRender(asyncProps, this.cachedAsyncProps);          
              }
              
              return null;
            }}
          </Async.Fulfilled>
        </Async>
      </div>
    );
  }
}

const ErrorLoading = ({ displayName, error, width, height }) => {
  console.log(error); // log to console as this is an unepected error
  return (
    <div
      style={{
        position: "fixed",
        fontWeight: 500,
        top: height / 2,
        left: globals.leftSidebarWidth + width / 2 - 50,
      }}
    >
      <span>{`Failure loading ${displayName}`}</span>
    </div>
  );
};

const StillLoading = ({ displayName, width, height }) => {
  /*
  Render a busy/loading indicator
  */
  return (
    <div
      style={{
        position: "fixed",
        fontWeight: 500,
        top: height / 2,
        width,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          justifyItems: "center",
          alignItems: "center",
        }}
      >
        <Button minimal loading intent="primary" />
        <span style={{ fontStyle: "italic" }}>Loading {displayName}</span>
      </div>
    </div>
  );
};

export default Graph;

