import React, { useEffect, useRef } from "react";
import { connect, shallowEqual } from "react-redux";
import { Button, ButtonGroup, AnchorButton } from "@blueprintjs/core";
import _regl from "regl";
import * as d3 from "d3";
import { mat3 } from "gl-matrix";
import memoize from "memoize-one";
import Async from "react-async";
import _camera from "../../util/camera";

import * as globals from "../../globals";
import styles from "./volcanoplot.css";
import _drawPoints from "./drawPointsRegl";
import { margin, width, height } from "./util";
import setupSVGandBrushElements from "./setupSVGandBrush";
import actions from "../../actions";
import renderThrottle from "../../util/renderThrottle";
import {
  flagBackground,
  flagSelected,
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

function getScale(col, rangeMin, rangeMax,bufferMin,bufferMax) {
  if (!col) return null;
  let min = Math.min(...col);
  min -= Math.abs(min * bufferMin);
  let max = Math.max(...col)+bufferMax;
  max += Math.abs(max * bufferMax);
  return d3.scaleLinear().domain([min, max]).range([rangeMin, rangeMax]);
}
const getXScale = memoize(getScale);
const getYScale = memoize(getScale);

/*function createProjectionTF(viewportWidth, viewportHeight) {
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
}*/

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

  return {
    annoMatrix: state.annoMatrix,
    colors: state.colors,
    pointDilation: state.pointDilation,
    volcanoAccessor: state.controls.volcanoAccessor,
    currentSelection: state.volcanoSelection.selection,    
    crossfilter,
    selectionTool: "lasso",
    genesets: state.genesets.genesets,
    allGenes: state.controls.allGenes
  };
})
class Volcanoplot extends React.PureComponent {
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
    const camera = _camera(canvas);

    // preallocate webgl buffers
    const pointBuffer = regl.buffer();
    const colorBuffer = regl.buffer();
    const flagBuffer = regl.buffer();

    return {
      camera,
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
  componentDidUpdate(prevProps, prevState) {
    const {
      selectionTool,
      currentSelection,
      volcanoAccessor
    } = this.props;
    
    
    const { toolSVG, viewport } = this.state;
    const hasResized =
      prevState.viewport.height !== viewport.height ||
      prevState.viewport.width !== viewport.width;
    let stateChanges = {};
    if (volcanoAccessor !== prevProps.volcanoAccessor){
      stateChanges = {...stateChanges, lastVolcanoAccessor: volcanoAccessor, loading: true};
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
    
    /*
    if the selection tool or state has changed, ensure that the selection
    tool correctly reflects the underlying selection.
    */
    if (
      currentSelection !== prevProps.currentSelection ||
      stateChanges.toolSVG
    ) {
      const { tool, container } = this.state;
      this.selectionToolUpdate(
        stateChanges.tool ? stateChanges.tool : tool,
        stateChanges.container ? stateChanges.container : container
      );
    }
    if (Object.keys(stateChanges).length > 0) {

      // eslint-disable-next-line react/no-did-update-set-state --- Preventing update loop via stateChanges and diff checks
      this.setState(stateChanges);
    }

  }

  /*brushToolUpdate(tool, container) {

    const { currentSelection } = this.props;
    if (container) {
      const toolCurrentSelection = d3.brushSelection(container.node());

      if (currentSelection.mode === "within-rect") {

        const screenCoords = [
          this.mapPointToScreen(currentSelection.brushCoords.northwest),
          this.mapPointToScreen(currentSelection.brushCoords.southeast),
        ];
        if (!toolCurrentSelection) {
          container.call(tool.move, screenCoords);
        } else {
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
        container.call(tool.move, null);
      }
    }
  }*/

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
      /*case "brush":
        this.brushToolUpdate(tool, container);
        break;*/
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

  computePointPositions = memoize((X, Y, xScale, yScale) => {
    const positions = new Float32Array(2 * X.length);
    for (let i = 0, len = X.length; i < len; i += 1) {
      positions[2 * i] = xScale(X[i]);
      positions[2 * i + 1] = yScale(Y[i]);
    }
    return positions;
  });

  computePointColors = memoize((nVar) => {
    /*
    compute webgl colors for each point
    */
    const colors = new Float32Array(3 * nVar);
    for (let i = 0, len = nVar; i < len; i += 1) {
      colors.set([0,0,0], 3 * i);
    }
    return colors;
  });

  computeSelectedFlags = memoize(
    (_nVar,_flagSelected,_flagUnselected,_selectedGenes) => {
      const x = new Float32Array(_nVar)
      if (_selectedGenes.length === 0) {
        for (let i = 0; i < x.length; i+=1){
          x[i] = _flagSelected
        }
      } else {
        for (let i = 0; i < x.length; i+=1){
          x[i] = _flagUnselected
        }        
        for (let i = 0; i < _selectedGenes.length; i+=1){
          x[_selectedGenes[i]] = _flagSelected
        }        
      }
      return x;
    }
  );


  computePointFlags = memoize(
    (nVar,selectedGenes) => {
      const selectedFlags = this.computeSelectedFlags(
        nVar,
        flagSelected,
        flagBackground,
        selectedGenes
      );
      return selectedFlags;
    }
  );

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
      sgInitial: [],
      viewport,
      selectedGenes: [],
      projectionTF: createProjectionTF(width, height),
    };
  }

  componentDidMount() {
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
        ...Volcanoplot.createReglState(canvas),
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
    const { selectedGenes } = this.state;
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
    this.setState({selectedGenes: [...new Set([...I, ...selectedGenes])]})
  }

  fetchAsyncProps = async (props) => {
    const {
      nVar,
      volcanoAccessor,
      selectedGenes,
      sgInitial
    } = props.watchProps;
    let yScale;
    let xScale;
    let positions;
    if (volcanoAccessor !== this.state.lastVolcanoAccessor || !this.state.lastVolcanoAccessor) {
      const [result, result2] = await this.fetchData(volcanoAccessor);
      const { pop } = result;
      const {pop: sgInitial} = result2;
      const xCol = [];
      const yCol = [];
      const gIdx = [];
      pop.forEach((item)=>{
        gIdx.push(item[0])
        xCol.push(item[1])
        yCol.push(Math.min(200,-Math.log10(item[3])))
      })
      xScale = getXScale(xCol, 0, width,0.1,0.1);
      yScale = getYScale(yCol, height, 0,0.01,0.1);      
      positions = this.computePointPositions(
        xCol,
        yCol,
        xScale,
        yScale
      );      
      this.setState({...this.state,positions, gIdx, xScale, yScale, sgInitial, lastVolcanoAccessor: volcanoAccessor, loading: false})
    } else {
      positions = this.state.positions;
      xScale = this.state.xScale;
      yScale = this.state.yScale;
    }
    const colors = this.computePointColors(nVar);
    
    let flags;
    if (sgInitial.length > 0 && selectedGenes.length === 0){
      flags = this.computePointFlags(nVar, sgInitial);
    } else {
      flags = this.computePointFlags(nVar, selectedGenes);
    }
    

    return {
      positions,
      colors,
      flags,
      width,
      height,
      xScale,
      yScale,
    };
  };
  createToolSVG = () => {
    /*
    Called from componentDidUpdate. Create the tool SVG, and return any
    state changes that should be passed to setState().
    */
    const { selectionTool } = this.props;
    const { viewport } = this.state;

    /* clear out whatever was on the div, even if nothing, but usually the brushes etc */
    const lasso = d3.select("#lasso-layer-volcano");
    if (lasso.empty()) return {}; // still initializing
    lasso.selectAll(".lasso-group-volcano").remove();


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

  async fetchData(
    volcanoAccessor
  ) {
    const name = volcanoAccessor.split('//;;//;;').at(0)
    const pop = volcanoAccessor.split('//;;//;;').at(1)
    const res = await fetch(
      `${globals.API.prefix}${globals.API.version}diffExpStats?name=${encodeURIComponent(name)}&pop=${encodeURIComponent(pop)}`,
      {credentials: "include"}
    );
    const result = await res.json();  

    const res2 = await fetch(
      `${globals.API.prefix}${globals.API.version}diffExpGenes?name=${encodeURIComponent(name)}&pop=${encodeURIComponent(pop)}`,
      {credentials: "include"}
    )
    const result2 = await res2.json();
    return [result, result2];
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

  updateReglAndRender(newRenderCache) { //#TODO: might need to port from graph.js
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
      count: annoMatrix.nVar,
      nPoints: schema.dataframe.nVar,
      minViewportDimension: Math.min(
        viewport.width - globals.leftSidebarWidth || width,
        viewport.height || height
      ),
    });
    regl._gl.flush();
  }

  handleSetUpdate = () => {
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

  handleDeleteGeneFromSet = () => {
    const { dispatch, group, gene, geneset } = this.props;
    dispatch(actions.genesetDeleteGenes(group, geneset, [gene]));
  };

  render() {
    const {
      dispatch,
      annoMatrix,
      volcanoAccessor,
      rightWidth
    } = this.props;
    
    const { minimized, regl, viewport, selectedGenes, xScale, yScale, sgInitial, loading } = this.state;
    const bottomToolbarGutter = 48; // gutter for bottom tool bar
    return (
      <div
        style={{
          position: "fixed",
          bottom: bottomToolbarGutter,
          borderRadius: "3px 3px 0px 0px",
          right: rightWidth + globals.scatterplotMarginLeft,
          padding: "0px 20px 20px 0px",
          background: "white",
          /* x y blur spread color */
          boxShadow: "0px 0px 3px 2px rgba(153,153,153,0.2)",
          zIndex: 1,
        }}
        id="volcanoplot_wrapper"
      >
        <ButtonGroup
          style={{
            position: "absolute",
            right: 5,
            top: 5,
          }}
        >
          <AnchorButton
            icon="circle"
            loading={loading}
            minimal
          />
          <Button
            type="button"
            minimal
            onClick={() => {
              this.setState({ minimized: !minimized });
            }}
          >
            {minimized ? "show volcanoplot" : "hide"}
          </Button>
          {!minimized && <Button
            type="button"
            minimal
            onClick={() => {
              this.setState({ selectedGenes: [] });
            }}
          >
            clear
          </Button>}          
          {!minimized && <Button
            type="button"
            minimal
            onClick={() => {
              if (selectedGenes.length > 0){
                const name = volcanoAccessor.split('//;;//;;').at(0)
                const pop = volcanoAccessor.split('//;;//;;').at(1)
                
                fetch(
                  `${globals.API.prefix}${globals.API.version}diffExpGenes`,
                  {
                    method: "PUT",
                    headers: new Headers({
                      Accept: "application/octet-stream",
                      "Content-Type": "application/json",
                    }),
                    body: JSON.stringify({
                      name,
                      pop,
                      selectedGenes
                    }),
                    credentials: "include",
                  }
                ); 
                this.handleSetUpdate()             
                this.setState({ selectedGenes: [], sgInitial: selectedGenes });
              }
            }}
          >
            update
          </Button>}            
          <Button
            type="button"
            minimal
            data-testid="clear-volcanoplot"
            onClick={() =>
              dispatch({
                type: "clear volcano plot",
              })
            }
          >
            remove
          </Button>
        </ButtonGroup>
        <div
          className={styles.volcanoplot}
          id="volcanoplot"
          style={{
            width: `${width + margin.left + margin.right}px`,
            height: `${
              (minimized ? 0 : height + margin.top) + margin.bottom+(minimized ? 0 : 10)
            }px`,
          }}
        >
          <svg
            id="lasso-layer-volcano"
            data-testid="layout-overlay-volcano"
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
            data-testid="volcanoplot"
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
          {xScale && yScale && <VolcanoplotAxis
            minimized={minimized}
            xScale={xScale}
            yScale={yScale}
          />}          
          <Async
            watchFn={Volcanoplot.watchAsync}
            promiseFn={this.fetchAsyncProps}
            watchProps={{
              nVar: annoMatrix.schema.dataframe.nVar,
              volcanoAccessor,
              selectedGenes,
              sgInitial,
              viewport,
            }}
          >
            <Async.Pending initial>Loading...</Async.Pending>
            <Async.Rejected>{(error) => error.message}</Async.Rejected>
            <Async.Fulfilled>
              {(asyncProps) => {
                if (regl && !shallowEqual(asyncProps, this.renderCache)) {
                  this.updateReglAndRender(asyncProps);
                }
              }}
            </Async.Fulfilled>
          </Async>
        </div>
      </div>
    );
  }
}

export default Volcanoplot;

const VolcanoplotAxis = React.memo(
  ({
    minimized,
    xScale,
    yScale,
  }) => {
    /*
    Axis for the volcanoplot, rendered with SVG/D3.  Props:
      * volcanoplotXXaccessor - name of X axis
      * volcanoplotXXaccessor - name of Y axis
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
        .attr("class", "label")
        .attr("text-anchor", "end")
        .attr("y", 6)
        .attr("dy", "-3.3em")        
        .attr("transform", "rotate(-90)")        
        .attr("x",-60)
        .style("font-style", "italic")
        .text("Statistical significance (p-value)");

      svg
        .append("text")
        .attr("x", width/1.4)
        .attr("y", height - 10)
        .attr("dy", "3.3em")        
        .attr("text-anchor", "end")
        .attr("class", "label")
        .style("font-style", "italic")
        .text("Effect size (Fold change)");
    }, [xScale, yScale]);

    return (
      <svg
        width={width + margin.left + margin.right}
        height={height + margin.top + margin.bottom+(minimized ? 0 : 20)}
        data-testid="volcanoplot-svg"
        style={{
          display: minimized ? "none" : null,
        }}
      >
        <g ref={svgRef} transform={`translate(${margin.left},${margin.top})`} />
      </svg>
    );
  }
);
