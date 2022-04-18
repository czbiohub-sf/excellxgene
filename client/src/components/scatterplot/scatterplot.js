import React, { useEffect, useRef } from "react";
import { connect, shallowEqual } from "react-redux";
import { Button, ButtonGroup } from "@blueprintjs/core";
import _regl from "regl";
import * as d3 from "d3";
import { mat3 } from "gl-matrix";
import memoize from "memoize-one";
import Async from "react-async";

import * as globals from "../../globals";
import styles from "./scatterplot.css";
import _drawPoints from "./drawPointsRegl";
import { margin, width, height } from "./util";
import {
  createColorTable,
  createColorQuery,
} from "../../util/stateManager/colorHelpers";
import renderThrottle from "../../util/renderThrottle";
import setupSVGandBrushElements from "./setupSVGandBrush";
import {
  flagBackground,
  flagSelected,
  flagHighlight,
  flagHalfSelected
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
function createProjectionTF(viewportWidth, viewportHeight) {
  /*
  the projection transform accounts for the screen size & other layout
  */
  const m = mat3.create();
  return mat3.projection(m, viewportWidth, viewportHeight);
}

function getScale(col, rangeMin, rangeMax) {
  if (!col) return null;
  const { min, max } = col.summarize();
  return d3.scaleLinear().domain([min, max]).range([rangeMin, rangeMax]);
}
const getXScale = memoize(getScale);
const getYScale = memoize(getScale);

function createModelTF() {
  /*
  preallocate coordinate system transformation between data and gl.
  Data arrives in a [0,1] range, and we operate elsewhere in [-1,1].
  */
  const m = mat3.fromScaling(mat3.create(), [2, 2]);
  mat3.translate(m, m, [-0.5, -0.5]);
  return m;
}


@connect((state) => {
  const { obsCrossfilter: crossfilter } = state;
  const { scatterplotXXaccessor, scatterplotYYaccessor, scatterplotXXisObs, scatterplotYYisObs } = state.controls;

  return {
    annoMatrix: state.annoMatrix,
    obsCrossfilter: state.obsCrossfilter,
    colors: state.colors,
    pointDilation: state.pointDilation,

    // Accessors are var/gene names (strings)
    scatterplotXXaccessor,
    scatterplotYYaccessor,
    scatterplotXXisObs,
    scatterplotYYisObs,
    crossfilter,
    genesets: state.genesets.genesets,
    dataLayerExpr: state.reembedParameters.dataLayerExpr,
    logScaleExpr: state.reembedParameters.logScaleExpr,
    scaleExpr: state.reembedParameters.scaleExpr,
    chromeKeyCategorical: state.controls.chromeKeyCategorical,
    chromeKeyContinuous: state.controls.chromeKeyContinuous,
    selectionTool: "lasso",
  };
})
class Scatterplot extends React.PureComponent {
  static createReglState(canvas) {
    /*
    Must be created for each canvas
    */

    // regl will create a top-level, full-screen canvas if we pass it a null.
    // canvas should never be null, so protect against that.
    if (!canvas) return {};

    // setup canvas, webgl draw function and camera
    const regl = _regl(canvas);
    const drawPoints = _drawPoints(regl);

    // preallocate webgl buffers
    const pointBuffer = regl.buffer();
    const colorBuffer = regl.buffer();
    const flagBuffer = regl.buffer();

    return {
      regl,
      drawPoints,
      pointBuffer,
      colorBuffer,
      flagBuffer,
    };
  }

  static watchAsync(props, prevProps) {
    return !shallowEqual(props.watchProps, prevProps.watchProps);
  }
  constructor(props) {
    super(props);
    const viewport = this.getViewportDimensions();
    const modelTF = createModelTF();
    this.axes = false;
    this.reglCanvas = null;
    this.renderCache = null;
    this.state = {
      toolSVG: null,
      tool: null,
      container: null,
      camera: null,
      modelTF,
      modelInvTF: mat3.invert([], modelTF),
      //projectionTF: createProjectionTF(viewport.width, viewport.height),
      regl: null,
      drawPoints: null,
      minimized: null,
      viewport,
      selectedCells: [],
      projectionTF: createProjectionTF(width, height),
    };
  }
  computePointPositions = memoize((X, Y, xScale, yScale) => {
    const positions = new Float32Array(2 * X.length);
    for (let i = 0, len = X.length; i < len; i += 1) {
      positions[2 * i] = xScale(X[i]);
      positions[2 * i + 1] = yScale(Y[i]);
    }
    return positions;
  });

  computePointColors = memoize((rgb) => {
    /*
    compute webgl colors for each point
    */
    const colors = new Float32Array(3 * rgb.length);
    for (let i = 0, len = rgb.length; i < len; i += 1) {
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

      const flags = new Float32Array(nObs);
      for (let i = 0; i < nObs; i += 1) {
        flags[i] = selectedFlags[i] + highlightFlags[i] + colorByFlags[i];
      }

      return flags;
    }
  );

  handleLassoStart() {
    // do nothing
  }
    
  // when a lasso is completed, filter to the points within the lasso polygon
  handleLassoEnd(polygon) {
    const minimumPolygonArea = 10;
    if (
      polygon.length < 3 ||
      Math.abs(d3.polygonArea(polygon)) < minimumPolygonArea
    ) {
      // do nothing
    } else {
      this.selectWithinPolygon(polygon)
    }
  }

  handleLassoCancel() {
    // do nothing
  }

  handleLassoDeselectAction() {
    // do nothing
  }
  createToolSVG = () => {
    /*
    Called from componentDidUpdate. Create the tool SVG, and return any
    state changes that should be passed to setState().
    */
    const { selectionTool } = this.props;
    const { viewport } = this.state;

    /* clear out whatever was on the div, even if nothing, but usually the brushes etc */
    const lasso = d3.select("#lasso-layer-scatter");
    if (lasso.empty()) return {}; // still initializing
    lasso.selectAll(".lasso-group-scatter").remove();


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
  selectWithinPolygon(polygon) {
    const { dispatch, obsCrossfilter, annoMatrix } = this.props;
    const [minX, minY, maxX, maxY] = this.polygonBoundingBox(polygon);
    const { positions } = this.state;
    const I = [];
    let i = 0;
    for (let z = 0; z < positions.length; z+=2) {
      const x = positions[z]
      const y = positions[z+1]
      if (!(x < minX || x > maxX || y < minY || y > maxY)) {
        if (withinPolygon(polygon,x,y)){
          I.push(i)
        }
      }
      i+=1;
    }
    
    const arr = new Array(annoMatrix.nObs);
    obsCrossfilter.fillByIsSelected(arr, true, false);

    annoMatrix.fetch("obs", "name_0").then(async (nameDf)=>{
      const rowNames = nameDf.__columns[0];
      const values = [];
      I.forEach((item)=>{
        if (arr[item]){
          values.push(rowNames[item])
        }
      })
      const selection = {
        mode: "exact",
        values,
      }; 
      const newObsCrossfilter = await obsCrossfilter.select("obs", "name_0", selection);
      dispatch({
        type: "",
        obsCrossfilter: newObsCrossfilter
      });
    })
  }  
  handleCanvasEvent = (e) => {
    const { camera, projectionTF } = this.state;
    if (e.type !== "wheel") e.preventDefault();
    if (camera.handleEvent(e, projectionTF)) {
      this.renderCanvas();
      this.setState((state) => {
        return { ...state, updateOverlay: !state.updateOverlay };
      });
    }
  };  
  handleSelect = () => { //FindMe
    const { volcanoAccessor, allGenes, dispatch } = this.props;
    
    const group = `${volcanoAccessor.split('//;;//;;').at(0)}//;;//`
    const geneset = volcanoAccessor.split('//;;//;;').at(1)

    const { selectedGenes: genesToAdd, gIdx, sgInitial } = this.state;

    const gI = [];
    sgInitial.forEach((item)=>{
      gI.push(allGenes.__columns[0][gIdx[item]])
    })
    const gA = [];
    genesToAdd.forEach((item)=>{
      gA.push(allGenes.__columns[0][gIdx[item]])
    })    
    dispatch(actions.genesetDeleteGenes(group, geneset, gI));
    dispatch(actions.genesetAddGenes(group, geneset, gA));
  };

  componentDidUpdate(prevProps, prevState) {
    const {
      selectionTool,
      scatterplotXXaccessor,
      scatterplotYYaccessor
    } = this.props;
    
    
    const { toolSVG, viewport } = this.state;
    const hasResized =
      prevState.viewport.height !== viewport.height ||
      prevState.viewport.width !== viewport.width;
    let stateChanges = {};
    if (scatterplotXXaccessor !== prevProps.scatterplotXXaccessor || scatterplotYYaccessor !== prevProps.scatterplotYYaccessor){
      stateChanges = {...stateChanges, loading: true};
    }
    if (
      (viewport.height && viewport.width && !toolSVG) || // first time init
      hasResized || //  window size has changed we want to recreate all SVGs
      selectionTool !== prevProps.selectionTool // change of selection tool
    ) {
      stateChanges = {
        ...stateChanges,
        ...this.createToolSVG(),
      };
    }
  }

  componentDidMount() {
    // this affect point render size for the scatterplot
    window.addEventListener("resize", this.handleResize);
  }

  componentWillUnmount() {
    window.removeEventListener("resize", this.handleResize);
  }

  setReglCanvas = (canvas) => {
    this.reglCanvas = canvas;
    if (canvas) {
      // no need to update this state if we are detaching.
      this.setState({
        ...Scatterplot.createReglState(canvas),
      });
    }
  };

  getViewportDimensions = () => {
    return {
      height: window.innerHeight,
      width: window.innerWidth,
    };
  };

  handleResize = () => {
    const { state } = this.state;
    const viewport = this.getViewportDimensions();
    this.setState({
      ...state,
      viewport,
    });
  };

  fetchAsyncProps = async (props) => {
    const {
      scatterplotXXaccessor,
      scatterplotYYaccessor,
      scatterplotXXisObs,
      scatterplotYYisObs,
      colors: colorsProp,
      crossfilter,
      pointDilation,
      chromeKeyCategorical,
      chromeKeyContinuous
    } = props.watchProps;

    const [
      expressionXDf,
      expressionYDf,
      colorDf,
      pointDilationDf,
    ] = await this.fetchData(
      scatterplotXXaccessor,
      scatterplotYYaccessor,
      scatterplotXXisObs,
      scatterplotYYisObs,
      colorsProp,
      pointDilation
    );
    const colorTable = this.updateColorTable(colorsProp, colorDf);

    const xCol = expressionXDf.icol(0);
    const yCol = expressionYDf.icol(0);
    const xScale = getXScale(xCol, 0, width);
    const yScale = getYScale(yCol, height, 0);
    const positions = this.computePointPositions(
      xCol.asArray(),
      yCol.asArray(),
      xScale,
      yScale
    );

    this.setState({...this.state,positions})
    const colors = this.computePointColors(colorTable.rgb);

    const { colorAccessor } = colorsProp;
    const colorByData = colorDf?.col(colorAccessor)?.asArray();
    const {
      metadataField: pointDilationCategory,
      categoryField: pointDilationLabel,
    } = pointDilation;
    const pointDilationData = pointDilationDf
      ?.col(pointDilationCategory)
      ?.asArray();


    const flags = this.computePointFlags(
      crossfilter,
      colorByData,
      colorsProp.colorMode,
      colorDf,      
      pointDilationData,
      pointDilationLabel
    );

    return {
      positions,
      colors,
      flags,
      width,
      height,
      xScale,
      yScale,
      chromeKeyCategorical,
      chromeKeyContinuous
    };
  };

  createXQuery(geneName) {
    const { annoMatrix } = this.props;
    const { schema } = annoMatrix;
    const varIndex = schema?.annotations?.var?.index;
    if (!varIndex) return null;
    return [
      "X",
      {
        where: {
          field: "var",
          column: varIndex,
          value: geneName,
        },
      },
    ];
  }

  createObsQuery(geneName) {
    return [
      "obs",
      geneName
    ];
  }  

  createColorByQuery(colors) {
    const { annoMatrix, genesets } = this.props;
    const { schema } = annoMatrix;
    const { colorMode, colorAccessor } = colors;
    return createColorQuery(colorMode, colorAccessor, schema, genesets);
  }

  updateColorTable(colors, colorDf) {
    /* update color table state */
    const { annoMatrix, chromeKeyCategorical, chromeKeyContinuous } = this.props;
    const { schema } = annoMatrix;
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

  async fetchData(
    scatterplotXXaccessor,
    scatterplotYYaccessor,
    scatterplotXXisObs,
    scatterplotYYisObs,
    colors,
    pointDilation
  ) {
    const { annoMatrix } = this.props;
    const { metadataField: pointDilationAccessor } = pointDilation;

    const promises = [];
    // X and Y dimensions
    if (scatterplotXXisObs) {
      promises.push(
        annoMatrix.fetch(...this.createObsQuery(scatterplotXXaccessor))
      );
    } else {
      promises.push(
        annoMatrix.fetch(...this.createXQuery(scatterplotXXaccessor))
      );
    }
    if (scatterplotYYisObs) {
      promises.push(
        annoMatrix.fetch(...this.createObsQuery(scatterplotYYaccessor))
      ); 
    } else {
      promises.push(
        annoMatrix.fetch(...this.createXQuery(scatterplotYYaccessor))
      );     
    }

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

  renderCanvas = renderThrottle(() => {
    const {
      regl,
      drawPoints,
      colorBuffer,
      pointBuffer,
      flagBuffer,
      projectionTF,
    } = this.state;
    this.renderPoints(
      regl,
      drawPoints,
      flagBuffer,
      colorBuffer,
      pointBuffer,
      projectionTF
    );
  });

  updateReglAndRender(newRenderCache) {
    const { positions, colors, flags } = newRenderCache;
    this.renderCache = newRenderCache;
    const { pointBuffer, colorBuffer, flagBuffer } = this.state;
    pointBuffer({ data: positions, dimension: 2 });
    colorBuffer({ data: colors, dimension: 3 });
    flagBuffer({ data: flags, dimension: 1 });
    this.renderCanvas();
  }

  renderPoints(
    regl,
    drawPoints,
    flagBuffer,
    colorBuffer,
    pointBuffer,
    projectionTF
  ) {
    const { annoMatrix } = this.props;
    if (!this.reglCanvas || !annoMatrix) return;

    const { schema } = annoMatrix;
    const { viewport } = this.state;
    regl.poll();
    regl.clear({
      depth: 1,
      color: [1, 1, 1, 1],
    });
    drawPoints({
      flag: flagBuffer,
      color: colorBuffer,
      position: pointBuffer,
      projection: projectionTF,
      count: annoMatrix.nObs,
      nPoints: schema.dataframe.nObs,
      minViewportDimension: Math.min(
        viewport.width - globals.leftSidebarWidth || width,
        viewport.height || height
      ),
    });
    regl._gl.flush();
  }

  render() {
    const {
      dispatch,
      annoMatrix,
      scatterplotXXaccessor,
      scatterplotYYaccessor,
      scatterplotXXisObs,
      scatterplotYYisObs,
      colors,
      crossfilter,
      pointDilation,
      dataLayerExpr,
      logScaleExpr,
      scaleExpr,
      chromeKeyCategorical,
      chromeKeyContinuous,
      leftWidth
    } = this.props;
    const { minimized, regl, viewport } = this.state;
    const bottomToolbarGutter = 48; // gutter for bottom tool bar

    return (
      <div
        style={{
          position: "fixed",
          bottom: bottomToolbarGutter,
          borderRadius: "3px 3px 0px 0px",
          left: leftWidth + globals.scatterplotMarginLeft,
          padding: "0px 20px 20px 0px",
          background: "white",
          /* x y blur spread color */
          boxShadow: "0px 0px 3px 2px rgba(153,153,153,0.2)",
          zIndex: 2,
        }}
        id="scatterplot_wrapper"
      >
        <ButtonGroup
          style={{
            position: "absolute",
            right: 5,
            top: 5,
          }}
        >
          <Button
            type="button"
            minimal
            onClick={() => {
              this.setState({ minimized: !minimized });
            }}
          >
            {minimized ? "show scatterplot" : "hide"}
          </Button>
          <Button
            type="button"
            minimal
            data-testid="clear-scatterplot-selection"
            onClick={async () => {
                const newObsCrossfilter = await this.props.obsCrossfilter.select("obs", "name_0", {
                  mode: "all",
                });         
                dispatch({type: "", obsCrossfilter: newObsCrossfilter})
              }     
            }
          >
            clear
          </Button>          
          <Button
            type="button"
            minimal
            data-testid="clear-scatterplot"
            onClick={() =>
              dispatch({
                type: "clear scatterplot",
              })
            }
          >
            remove
          </Button>
        </ButtonGroup>
        <div
          className={styles.scatterplot}
          id="scatterplot"
          style={{
            width: `${width + margin.left + margin.right}px`,
            height: `${
              (minimized ? 0 : height + margin.top) + margin.bottom
            }px`,
          }}
        >
          <svg
            id="lasso-layer-scatter"
            data-testid="layout-overlay-scatter"
            className="graph-svg"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              zIndex: 1,
              marginLeft: margin.left,
              marginTop: margin.top,
              display: minimized ? "none" : null,              
            }}
            width={width}
            height={height}
            pointerEvents="auto"
          />               
          <canvas
            width={width}
            height={height}
            data-testid="scatterplot"
            style={{
              marginLeft: margin.left,
              marginTop: margin.top,
              display: minimized ? "none" : null,
            }}
            ref={this.setReglCanvas}
            onMouseDown={this.handleCanvasEvent}
            onMouseUp={this.handleCanvasEvent}
            onMouseMove={this.handleCanvasEvent}
            onDoubleClick={this.handleCanvasEvent}
            onWheel={this.handleCanvasEvent}                 
          />
          <Async
            watchFn={Scatterplot.watchAsync}
            promiseFn={this.fetchAsyncProps}
            watchProps={{
              annoMatrix,
              scatterplotXXaccessor,
              scatterplotYYaccessor,
              scatterplotXXisObs,              
              scatterplotYYisObs,
              colors,
              crossfilter,
              pointDilation,
              viewport,
              dataLayerExpr,
              logScaleExpr,
              scaleExpr,
              chromeKeyCategorical,
              chromeKeyContinuous
            }}
          >
            <Async.Pending initial>Loading...</Async.Pending>
            <Async.Rejected>{(error) => error.message}</Async.Rejected>
            <Async.Fulfilled>
              {(asyncProps) => {
                if (regl && !shallowEqual(asyncProps, this.renderCache)) {
                  this.updateReglAndRender(asyncProps);
                }
                return (
                  <ScatterplotAxis
                    minimized={minimized}
                    scatterplotYYaccessor={scatterplotYYaccessor}
                    scatterplotXXaccessor={scatterplotXXaccessor}
                    xScale={asyncProps.xScale}
                    yScale={asyncProps.yScale}
                  />
                );
              }}
            </Async.Fulfilled>
          </Async>
        </div>
      </div>
    );
  }
}

export default Scatterplot;

const ScatterplotAxis = React.memo(
  ({
    minimized,
    scatterplotYYaccessor,
    scatterplotXXaccessor,
    xScale,
    yScale,
  }) => {
    /*
    Axis for the scatterplot, rendered with SVG/D3.  Props:
      * scatterplotXXaccessor - name of X axis
      * scatterplotXXaccessor - name of Y axis
      * xScale - D3 scale for X axis (domain to range)
      * yScale - D3 scale for Y axis (domain to range)

    This also relies on the GLOBAL width/height/margin constants.  If those become
    become variables, may need to add the params.
    */

    const svgRef = useRef(null);

    useEffect(() => {
      if (!svgRef.current || minimized) return;
      const svg = d3.select(svgRef.current);

      svg.selectAll("*").remove();

      // the axes are much cleaner and easier now. No need to rotate and orient
      // the axis, just call axisBottom, axisLeft etc.
      const xAxis = d3.axisBottom().ticks(7).scale(xScale);
      const yAxis = d3.axisLeft().ticks(7).scale(yScale);

      // adding axes is also simpler now, just translate x-axis to (0,height)
      // and it's alread defined to be a bottom axis.
      svg
        .append("g")
        .attr("transform", `translate(0,${height})`)
        .attr("class", "x axis")
        .call(xAxis);

      // y-axis is translated to (0,0)
      svg
        .append("g")
        .attr("transform", "translate(0,0)")
        .attr("class", "y axis")
        .call(yAxis);

      // adding label. For x-axis, it's at (10, 10), and for y-axis at (width, height-10).
      svg
        .append("text")
        .attr("x", 10)
        .attr("y", 10)
        .attr("class", "label")
        .style("font-style", "italic")
        .text(scatterplotYYaccessor);

      svg
        .append("text")
        .attr("x", width)
        .attr("y", height - 10)
        .attr("text-anchor", "end")
        .attr("class", "label")
        .style("font-style", "italic")
        .text(scatterplotXXaccessor);
    }, [scatterplotXXaccessor, scatterplotYYaccessor, xScale, yScale]);

    return (
      <svg
        width={width + margin.left + margin.right}
        height={height + margin.top + margin.bottom}
        data-testid="scatterplot-svg"
        style={{
          display: minimized ? "none" : null,
        }}
      >
        <g ref={svgRef} transform={`translate(${margin.left},${margin.top})`} />
      </svg>
    );
  }
);
