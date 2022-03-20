import React, { useEffect, useRef } from "react";
import { connect, shallowEqual } from "react-redux";
import { Button, ButtonGroup } from "@blueprintjs/core";
import _regl from "regl";
import * as d3 from "d3";
import { mat3 } from "gl-matrix";
import memoize from "memoize-one";
import Async from "react-async";

import * as globals from "../../globals";
import styles from "./volcanoplot.css";
import _drawPoints from "./drawPointsRegl";
import { margin, width, height } from "./util";
import {
  createColorTable,
  createColorQuery,
} from "../../util/stateManager/colorHelpers";
import renderThrottle from "../../util/renderThrottle";
import {
  flagBackground,
  flagSelected,
  flagHighlight,
} from "../../util/glHelpers";

function createProjectionTF(viewportWidth, viewportHeight) {
  /*
  the projection transform accounts for the screen size & other layout
  */
  const m = mat3.create();
  return mat3.projection(m, viewportWidth, viewportHeight);
}

function getScale(col, rangeMin, rangeMax) {
  if (!col) return null;
  const min = Math.min(...col);
  const max = Math.max(...col);
  return d3.scaleLinear().domain([min, max]).range([rangeMin, rangeMax]);
}
const getXScale = memoize(getScale);
const getYScale = memoize(getScale);

@connect((state) => {
  const { obsCrossfilter: crossfilter } = state;

  return {
    annoMatrix: state.annoMatrix,
    colors: state.colors,
    pointDilation: state.pointDilation,
    volcanoAccessor: state.controls.volcanoAccessor,
    crossfilter,
    genesets: state.genesets.genesets,
    dataLayerExpr: state.reembedParameters.dataLayerExpr,
    logScaleExpr: state.reembedParameters.logScaleExpr
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
    (_nVar,_flagSelected) => {
      const x = new Float32Array(_nVar)
      for (let i = 0; i < x.length; i+=1){
        x[i] = _flagSelected
      }
      return x;
    }
  );

  computeHighlightFlags = memoize(
    (nVar, pointDilationData, pointDilationLabel) => {
      const flags = new Float32Array(nVar);
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

  computeColorByFlags = memoize((nVar, colorByData) => {
    const flags = new Float32Array(nVar);
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
    (nVar) => {

      const selectedFlags = this.computeSelectedFlags(
        nVar,
        flagSelected
      );
      return selectedFlags;
    }
  );

  constructor(props) {
    super(props);
    const viewport = this.getViewportDimensions();
    this.axes = false;
    this.reglCanvas = null;
    this.renderCache = null;
    this.state = {
      regl: null,
      drawPoints: null,
      minimized: null,
      viewport,
      projectionTF: createProjectionTF(width, height),
    };
  }

  componentDidMount() {
    // this affect point render size for the volcanoplot
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

  fetchAsyncProps = async (props) => {
    const {
      nVar,
      volcanoAccessor,
    } = props.watchProps;

    const result = await this.fetchData(volcanoAccessor);
    const { pop } = result;
    const xCol = [];
    const yCol = [];
    pop.forEach((item)=>{
      xCol.push(item[1])
      yCol.push(Math.min(200,-Math.log10(item[3])))
    })
    console.log(Math.max(...yCol))
    const xScale = getXScale(xCol, 0, width);
    const yScale = getYScale(yCol, height, 0);
    const positions = this.computePointPositions(
      xCol,
      yCol,
      xScale,
      yScale
    );

    const colors = this.computePointColors(nVar);
    const flags = this.computePointFlags(nVar);

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

  async fetchData(
    volcanoAccessor
  ) {
    const name = volcanoAccessor.split('//;;//;;').at(0)
    let pop = volcanoAccessor.split('//;;//;;').at(1)
    if (pop === "Pop2 high") {
      pop = "Pop1 high";
    }
    const res = await fetch(
      `${globals.API.prefix}${globals.API.version}diffExpStats?name=${encodeURIComponent(name)}&pop=${encodeURIComponent(pop)}`
    );
    const result = await res.json();
    return result;
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
      count: annoMatrix.nVar,
      nPoints: schema.dataframe.nVar,
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
      volcanoAccessor,
      rightWidth
    } = this.props;
    const { minimized, regl, viewport } = this.state;
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
          zIndex: 2,
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
          <Button
            type="button"
            minimal
            onClick={() => {
              this.setState({ minimized: !minimized });
            }}
          >
            {minimized ? "show volcanoplot" : "hide"}
          </Button>
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
              (minimized ? 0 : height + margin.top) + margin.bottom+10
            }px`,
          }}
        >
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
          />
          <Async
            watchFn={Volcanoplot.watchAsync}
            promiseFn={this.fetchAsyncProps}
            watchProps={{
              nVar: annoMatrix.schema.dataframe.nVar,
              volcanoAccessor,
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
                return (
                  <VolcanoplotAxis
                    minimized={minimized}
                    volcanoAccessor={volcanoAccessor}
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

export default Volcanoplot;

const VolcanoplotAxis = React.memo(
  ({
    minimized,
    volcanoAccessor,
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
        height={height + margin.top + margin.bottom+20}
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
