import React, { useEffect } from "react";
import * as d3 from "d3";
import * as d3s from "d3-sankey";
import { connect } from "react-redux";
import { requestSankey } from "../../actions/sankey";
import Canvg, {
  presets
} from 'canvg';

@connect((state) => ({
    layoutChoice: state.layoutChoice,
    displaySankey: state.sankeySelection.displaySankey,
    sankeyData: state.sankeySelection.sankeyData,
    refresher: state.sankeySelection.dataRefresher,
    alignmentThreshold: state.sankeySelection.alignmentThreshold,
    numCells: state.annoMatrix.nObs,
    currCacheKey: state.sankeySelection.currCacheKey
}))
class Sankey extends React.Component {
  constructor(props) {
    super(props);
    const viewport = this.getViewportDimensions();
    this.sankeyTopPadding = 120;
    this.sankeyLeftPadding = 170;
    this.displayed = false;
    this.state = {
      viewport,
      height: viewport.height
    };
  }

  handleSankey = () => {
    const { dispatch, alignmentThreshold: threshold } = this.props;
    dispatch(requestSankey(threshold));
  };  

  handleResize = () => {
    const viewport = this.getViewportDimensions();
    this.setState({
      ...this.state,
      viewport,
    });
  };  
  constructSankey = () => {
    const { sankeyData: data, layoutChoice } = this.props
    if(data.nodes.length===0){
      return
    }
    const { viewport } = this.state
    const topMargin = this.sankeyTopPadding
    const leftMargin = this.sankeyLeftPadding
    const width = viewport.width 
    const nodeWidth = 24;
    const nodePadding = 16;
    const nodeOpacity = 0.8;
    const linkOpacity = 0.5;
    const nodeDarkenFactor = 0.3;
    const nodeStrokeWidth = 4;
    const arrow = "\u2192";
    const nodeAlignment = d3s.sankeyCenter;
    const colorScale = d3.interpolateRainbow;
    const path = d3s.sankeyLinkHorizontal();
    let initialMousePosition = {};
    let initialNodePosition = {};

    function addGradientStop(gradients, offset, fn) {
        return gradients.append("stop")
                        .attr("offset", offset)
                        .attr("stop-color", fn);
    }

    function color(index) {
        let ratio = index / (data.nodes.length - 1.0);
        return colorScale(ratio);
    }
    
    function darkenColor(color, factor) {
        return d3.color(color).darker(factor)
    }
    
    function getGradientId(d) {
        return `gradient_${d.source.id}_${d.target.id}`;
    }
    
    function getMousePosition(e) {
        e = e || d3.event;
        return {
            x: e.x,
            y: e.y
        };
    }
    
    function getNodePosition(node) {
        return {
            x: +node.attr("x"),
            y: +node.attr("y"),
            width: +node.attr("width"),
            height: +node.attr("height")
        };
    }
    
    function moveNode(node, position) {
        position.width = position.width || +(node.attr("width"));
        position.height = position.height || +(node.attr("height"));
        if (position.x < 0) {
            position.x = 0;
        }
        if (position.y < 0) {
            position.y = 0;
        }
        if (position.x + position.width > graphSize[0]) {
            position.x = graphSize[0] - position.width;
        }
        if (position.y + position.height > graphSize[1]) {
            position.y = graphSize[1] - position.height;
        }
        node.attr("x", position.x)
            .attr("y", position.y);
        let nodeData = node.data()[0];
        nodeData.x0 = position.x
        nodeData.x1 = position.x + position.width;
        nodeData.y0 = position.y;
        nodeData.y1 = position.y + position.height;
        sankey.update(graph);
        svgLinks.selectAll("linearGradient")
                .attr("x1", d => d.source.x1)
                .attr("x2", d => d.target.x0);
        svgLinks.selectAll("path")
                .attr("d", path);
    }
    
    function onDragDragging() {
        let currentMousePosition = getMousePosition(d3.event);
        let delta = {
            x: currentMousePosition.x - initialMousePosition.x,
            y: currentMousePosition.y - initialMousePosition.y
        };
        let thisNode = d3.select(this);
        let newNodePosition = {
            x: initialNodePosition.x + delta.x,
            y: initialNodePosition.y + delta.y,
            width: initialNodePosition.width,
            height: initialNodePosition.height
        };
        moveNode(thisNode, newNodePosition);        
    }
    
    function onDragEnd() {
        let node = d3.select(this)
                     .attr("stroke-width", 0);
    }
    
    function onDragStart() {
        let node = d3.select(this)
                     .raise()
                     .attr("stroke-width", nodeStrokeWidth);
        setInitialNodePosition(node);
        initialNodePosition = getNodePosition(node);
        initialMousePosition = getMousePosition(d3.event);
    }
    
    function reduceUnique(previous, current) {
        if (previous.indexOf(current) < 0) {
            previous.push(current);
        }
        return previous;
    }
    
    function setInitialMousePosition(e) {
        initialMousePosition.x = e.x;
        initialMousePosition.y = e.y;
    }
    
    function setInitialNodePosition(node) {
        let pos = node ? getNodePosition(node) : { x: 0, y: 0, width: 0, height: 0 };
        initialNodePosition.x = pos.x;
        initialNodePosition.y = pos.y;
        initialNodePosition.width = pos.width;
        initialNodePosition.height = pos.height;
    }
        
    function sumValues(previous, current) {
        previous += current;
        return previous;
    }
    
    d3.selectAll("#canvas > *").remove()
    const svg = d3.select("#canvas")
                  .append("g")
                  .attr("transform", `translate(${leftMargin},${topMargin})`);
    // Define our sankey instance.
    let height = 1500 / 25 * data.nodes.length / 2
    if (height < viewport.height) {
      height = viewport.height
    }
    const graphSize = [width - 2*leftMargin, height - 2*topMargin];
    this.setState({
      height: height
    })
    const temp_nodes = data.nodes;
    const un_node_ids = [];
    for (const ino of temp_nodes) {
      const inot = parseInt(ino.id.split('_').at(0).slice(-1));
      if (!un_node_ids.includes(inot)){
        un_node_ids.push(inot)
      }
    }
    const map = new Map();
    un_node_ids.forEach((item,i)=>{
      map.set(item,i)
    })
    
    const sankey = d3s.sankey()
                     .size(graphSize)
                     .nodeId(d => d.id)
                     .nodeWidth(nodeWidth)
                     .nodePadding(nodePadding)
                     //.nodeAlign((n,tn)=>map.get(parseInt(n.id.split('_').at(0).slice(-1))));

    let graph = sankey(data);
    
    // Loop through the nodes. Set additional properties to make a few things
    // easier to deal with later.
    graph.nodes.forEach(node => {
        let fillColor = color(node.index);
        node.fillColor = fillColor;
        node.strokeColor = darkenColor(fillColor, nodeDarkenFactor);
        node.width = node.x1 - node.x0;
        node.height = node.y1 - node.y0;
    });
    
    // Build the links.
    let svgLinks = svg.append("g")
                      .classed("links", true)
                      .selectAll("g")
                      .data(graph.links)
                      .enter()
                      .append("g");
    let gradients = svgLinks.append("linearGradient")
                            .attr("gradientUnits", "userSpaceOnUse")
                            .attr("x1", d => d.source.x1)
                            .attr("x2", d => d.target.x0)
                            .attr("id", d => getGradientId(d));
    addGradientStop(gradients, 0.0, d => color(d.source.index));
    addGradientStop(gradients, 1.0, d => color(d.target.index));
    svgLinks.append("path")
            .classed("link", true)
            .attr("d", path)
            .attr("fill", "none")
            .attr("stroke", d => `url(#${getGradientId(d)})`)
            .attr("stroke-width", d => Math.max(1.0, d.width))
            .attr("stroke-opacity", linkOpacity);
    
    // Add hover effect to links.
    svgLinks.append("title")
            .text(d => `${d.source.id.split('_').slice(1).join('_')} ${arrow} ${d.target.id.split('_').slice(1).join('_')}\n${d.value}`);

    let svgNodes = svg.append("g")
                      .classed("nodes", true)
                      .selectAll("rect")
                      .data(graph.nodes)
                      .enter()
                      .append("rect")
                      .classed("node", true)
                      .attr("x", d => d.x0)
                      .attr("y", d => d.y0)
                      .attr("width", d => d.width)
                      .attr("height", d => d.height)
                      .attr("fill", d => d.fillColor)
                      .attr("opacity", nodeOpacity)
                      .attr("stroke", d => d.strokeColor)
                      .attr("stroke-width", 0)
    let nodeDepths = graph.nodes
        .map(n => n.depth)
        .reduce(reduceUnique, []);
    
    nodeDepths.forEach(d => {
        let nodesAtThisDepth = graph.nodes.filter(n => n.depth === d);
        let numberOfNodes = nodesAtThisDepth.length;
        let totalHeight = nodesAtThisDepth
                            .map(n => n.height)
                            .reduce(sumValues, 0);

        let whitespace = graphSize[1] - totalHeight;
        let balancedWhitespace = whitespace / (numberOfNodes + 1.0);
    });
    
    // Add hover effect to nodes.
    svgNodes.append("title")
            .text(d => `${d.id}\n${d.value}`);
            
    svgNodes.call(d3.drag()
                    .on("start", onDragStart)
                    .on("drag", onDragDragging)
                    .on("end", onDragEnd));
    svg.append("g")
    .attr("font-family", "sans-serif")
    .attr("font-size", 14)
    .selectAll("text")
    .data(graph.nodes).enter().append("text")
    .attr("x", d => d.x0 < width / 2 ? d.x1 + 6 : d.x0 - 6)
    .attr("y", d => (d.y1 + d.y0) / 2)
    .attr("dy", "0.35em")
    .attr("text-anchor", d => d.x0 < width / 2 ? "start" : "end")
    .text(d => d.id.split('_').slice(1).join('_'))
    svg.attr("id","sankeyPlot");
    
    d3.select('#saveSankeyButton').on('click', function(){
      var s = document.querySelector('#sankeyPlot');
      var data = (new XMLSerializer()).serializeToString(s);
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      Canvg.from(ctx, data, presets.offscreen()).then((v)=>{
        v.render().then(()=>{
          canvas.convertToBlob().then((blob)=>{
            var a = document.createElement("a");
            document.body.appendChild(a);
            a.style = "display: none";
        
            var url = window.URL.createObjectURL(blob);
            a.href = url;
            a.download = `${layoutChoice.current.split(';;').at(-1)}_sankey.png`;
            a.click();
            window.URL.revokeObjectURL(url);
          });
        })
      });
    });    
  }

  handleResize = () => {
    const { state } = this.state;
    const viewport = this.getViewportDimensions();

    this.setState({
      ...state,
      viewport,
    });
    d3.selectAll("#canvas > *").remove()
    this.constructSankey()
  };
  componentDidUpdate(prevProps) {
    const { dispatch, refresher, numCells, currCacheKey } = this.props
    if(refresher !== prevProps.refresher) {
      this.constructSankey()
    } else if (numCells !== prevProps.numCells){
      dispatch({type: "sankey: clear cached result",key: currCacheKey})
      this.handleSankey()
    }
  }
  componentDidMount() {
    window.addEventListener("resize", this.handleResize);
    if(this.props.sankeyData){
      this.constructSankey();
    }
    
  }

  componentWillUnmount() {
    window.removeEventListener("resize", this.handleResize);
  }
  getViewportDimensions = () => {
    const { viewportRef } = this.props;
    return {
      height: viewportRef.clientHeight,
      width: viewportRef.clientWidth,
    };
  };

  render() {
    const { height } = this.state
    return (
      <div
        id="sankey-wrapper"
        style={{
          position: "relative",
          top: 0,
          left: 0,
          zIndex: -9999,
          width: "inherit",
          height: "inherit"
        }}
      >
        {<svg id="canvas" style={{width: "100%", height:height}}/>}
      </div>
    );
  }
}
export default Sankey;