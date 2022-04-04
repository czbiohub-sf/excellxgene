import React, { useContext, useEffect } from "react";
import { connect } from "react-redux";
import { ButtonGroup, AnchorButton, Slider, Tooltip, HotkeysContext, Dialog, ControlGroup, Checkbox, MenuItem } from "@blueprintjs/core";
import { Select } from "@blueprintjs/select"
import * as globals from "../../globals";
import styles from "./menubar.css";
import actions from "../../actions";
import Clip from "./clip";
import Subset from "./subset";
import UndoRedoReset from "./undoRedo";
import DiffexpButtons from "./diffexpButtons";
import Reembedding from "./reembedding";
import { getEmbSubsetView } from "../../util/stateManager/viewStackHelpers";
import { requestSankey } from "../../actions/sankey";
import StateParameterInput from "./parameterinputstate";
import * as chromatic from "d3-scale-chromatic";
import * as d3 from "d3";

function HotkeysDialog(props) {
  const { open } = props;
  const [, dispatch] = useContext(HotkeysContext);
  useEffect(() => {
    if ((open ?? "undefined") !== "undefined"){
      dispatch({ type: "OPEN_DIALOG" });
    }
  }, [open]);
  return <div />;
}

const continuous = (selectorId, colorScale) => {
  const legendHeight = 30;
  const legendWidth = 300;

  const canvas = d3
    .select(selectorId)
    .style("height", `${legendHeight}px`)
    .style("width", `${legendWidth}px`)
    .append("canvas")
    .attr("width", legendWidth)
    .attr("height", 1)
    .style("height", `${legendHeight}px`)
    .style("width", `${legendWidth}px`)
    .style("background","#ccc")
    .node();

  const ctx = canvas.getContext("2d");

  const legendScale = d3
    .scaleLinear()
    .range([1, legendWidth])
    .domain([
      colorScale.domain()[1],
      colorScale.domain()[0],
    ]); 

  const image = ctx.createImageData(legendWidth, 1);
  d3.range(legendWidth).forEach((i) => {
    const c = d3.rgb(colorScale(legendScale.invert(i)));
    image.data[4 * i] = c.r;
    image.data[4 * i + 1] = c.g;
    image.data[4 * i + 2] = c.b;
    image.data[4 * i + 3] = 255;
  });
  ctx.putImageData(image, 0, 0);

};

@connect((state) => {
  const { annoMatrix } = state;
  const crossfilter = state.obsCrossfilter;
  const selectedCount = crossfilter.countSelected();
  const numberCells = crossfilter.size();
  const subsetPossible =
    selectedCount !== 0 && selectedCount !== numberCells; // ie, not all and not none are selected
  const embSubsetView = getEmbSubsetView(annoMatrix);
  const subsetResetPossible = !embSubsetView
    ? annoMatrix.nObs !== annoMatrix.schema.dataframe.nObs
    : annoMatrix.nObs !== embSubsetView.nObs;
  let var_keys = state.annoMatrix?.schema?.annotations?.varByName ?? {};
  var_keys = Object.keys(var_keys);
  const vk = [];
  var_keys.forEach((item)=>{
    if (item !== "name_0"){
      vk.push(item.split(';;').at(0))
    }
  })
  return {
    subsetPossible,
    subsetResetPossible,
    var_keys: [... new Set(vk)],
    geneSelection: Object.keys(state.geneSelection),
    tooManyCells: numberCells > 50000,
    graphInteractionMode: state.controls.graphInteractionMode,
    clipPercentileMin: Math.round(100 * (annoMatrix?.clipRange?.[0] ?? 0)),
    clipPercentileMax: Math.round(100 * (annoMatrix?.clipRange?.[1] ?? 1)),
    userDefinedGenes: state.controls.userDefinedGenes,
    colorAccessor: state.colors.colorAccessor,
    scatterplotXXaccessor: state.controls.scatterplotXXaccessor,
    scatterplotYYaccessor: state.controls.scatterplotYYaccessor,
    libraryVersions: state.config?.library_versions,
    auth: state.config?.authentication,
    userInfo: state.userInfo,
    undoDisabled: state["@@undoable/past"].length === 0,
    redoDisabled: state["@@undoable/future"].length === 0,
    aboutLink: state.config?.links?.["about-dataset"],
    disableDiffexp: state.config?.parameters?.["disable-diffexp"] ?? false,
    diffexpMayBeSlow:
      state.config?.parameters?.["diffexp-may-be-slow"] ?? false,
    showCentroidLabels: state.centroidLabels.showLabels,
    tosURL: state.config?.parameters?.about_legal_tos,
    privacyURL: state.config?.parameters?.about_legal_privacy,
    categoricalSelection: state.categoricalSelection,
    displaySankey: state.sankeySelection.displaySankey,
    layoutChoice: state.layoutChoice,
    outputController: state.outputController,
    sankeyController: state.sankeyController,
    currCacheKey: state.sankeySelection.currCacheKey,
    maxLink: state.sankeySelection.maxLink,
    alignmentThreshold: state.sankeySelection.alignmentThreshold,
    userLoggedIn: state.controls.userInfo ? true : false,
    annoMatrix,
    pointScaler: state.controls.pointScaler,
    chromeKeyContinuous: state.controls.chromeKeyContinuous,
    chromeKeyCategorical: state.controls.chromeKeyCategorical,
    chromeKeys: Object.keys(chromatic).filter((item)=>item.startsWith("interpolate")).map((item)=>item.replace("interpolate","")).sort(),
    jointEmbeddingFlag: state.controls.jointEmbeddingFlag
  };
})
class MenuBar extends React.PureComponent {
  static isValidDigitKeyEvent(e) {
    /*
    Return true if this event is necessary to enter a percent number input.
    Return false if not.

    Returns true for events with keys: backspace, control, alt, meta, [0-9],
    or events that don't have a key.
    */
    if (e.key === null) return true;
    if (e.ctrlKey || e.altKey || e.metaKey) return true;

    // concept borrowed from blueprint's numericInputUtils:
    // keys that print a single character when pressed have a `key` name of
    // length 1. every other key has a longer `key` name (e.g. "Backspace",
    // "ArrowUp", "Shift"). since none of those keys can print a character
    // to the field--and since they may have important native behaviors
    // beyond printing a character--we don't want to disable their effects.
    const isSingleCharKey = e.key.length === 1;
    if (!isSingleCharKey) return true;

    const key = e.key.charCodeAt(0) - 48; /* "0" */
    return key >= 0 && key <= 9;
  }

  constructor(props) {
    super(props);
    this.state = {
      pendingClipPercentiles: null,
      threshold: 0,
      saveDataWarningDialogOpen: false,
      revealSankeyDialog: false,
      sankeyMethod: "Graph alignment",
      samHVG: false,
      numGenes: 3000,
      dataLayer: "X",
      geneMetadata: "sam_weights",
      numEdges: 5,
      preferencesDialogOpen: false
    };
  }

  handleSankey = (threshold,reset,params={sankeyMethod: "Graph alignment",numGenes: 3000, samHVG: false, dataLayer: "X", geneMetadata: "sam_weights", numEdges: 5}) => {
    const { dispatch, layoutChoice, geneSelection } = this.props;
    if (params['sankeyMethod'] === "Correlation (selected genes)"){
      params["selectedGenes"] = geneSelection
    } else {
      params["selectedGenes"] = [];
    }
    if (!layoutChoice.sankey || !reset) {
      const res = dispatch(requestSankey(threshold,params));
      res.then((resp)=>{
        if (resp) {
          const sankey = resp[0];
          const links = []
          const nodes = []
          let n = []
          sankey.edges.forEach(function (item, index) {
            if (sankey.weights[index] > threshold && item[0].split('_').slice(1).join('_') !== "unassigned" && item[1].split('_').slice(1).join('_') !== "unassigned"){
              links.push({
                source: item[0],
                target: item[1],
                value: sankey.weights[index]
              })
              n.push(item[0])
              n.push(item[1])
            }
          });   
          n = n.filter((item, i, ar) => ar.indexOf(item) === i);
    
          n.forEach(function (item){
            nodes.push({
              id: item
            })
          })
          const d = {links: links, nodes: nodes}
          dispatch({type: "sankey: set data",data: d})
        }
      })
      if (reset){
        dispatch({type: "toggle sankey"})
        dispatch({type: "sankey: set alignment score threshold", threshold: 0})   
        this.setState({
          ...this.state,
          threshold: 0
        })
      }
      return res;      
    } else {
      dispatch({type: "sankey: reset"})
      dispatch({type: "toggle sankey"})
      dispatch({type: "sankey: set alignment score threshold", threshold: 0})
      this.setState({
        ...this.state,
        threshold: 0
      })      
    }
  };
  componentDidUpdate = (prevProps) => {
    const { layoutChoice, chromeKeyCategorical, chromeKeyContinuous } = this.props;
    if (layoutChoice.current !== prevProps.layoutChoice.current){
      this.setState({
        ...this.state,
        threshold: 0
      })
    }

    if (chromeKeyCategorical !== prevProps.chromeKeyCategorical) {
      d3.select("#categorical_legend_preferences").selectAll("*").remove();
      continuous(
        "#categorical_legend_preferences",
        d3.scaleSequential(chromatic[`interpolate${chromeKeyCategorical}`]).domain([0,1])
      );    
    }
    if (chromeKeyContinuous !== prevProps.chromeKeyContinuous) {
      d3.select("#continuous_legend_preferences").selectAll("*").remove();
      continuous(
        "#continuous_legend_preferences",
        d3.scaleSequential(chromatic[`interpolate${chromeKeyContinuous}`]).domain([0,1])
      );    
    }    
  }
  handleSaveData = () => {
    const { dispatch, tooManyCells } = this.props;
    if (tooManyCells) {
      this.setState({
        ...this.state,
        saveDataWarningDialogOpen: true
      })
    } else {
      dispatch(actions.downloadData())
    }
  }
  dismissWarningDialog = () => {
    this.setState({
      ...this.state,
      saveDataWarningDialogOpen: false
    })
  }
  isClipDisabled = () => {
    /*
    return true if clip button should be disabled.
    */
    const { pendingClipPercentiles } = this.state;
    const clipPercentileMin = pendingClipPercentiles?.clipPercentileMin;
    const clipPercentileMax = pendingClipPercentiles?.clipPercentileMax;
    const {
      clipPercentileMin: currentClipMin,
      clipPercentileMax: currentClipMax,
    } = this.props;

    // if you change this test, be careful with logic around
    // comparisons between undefined / NaN handling.
    const isDisabled =
      !(clipPercentileMin < clipPercentileMax) ||
      (clipPercentileMin === currentClipMin &&
        clipPercentileMax === currentClipMax);

    return isDisabled;
  };

  handleClipOnKeyPress = (e) => {
    /*
    allow only numbers, plus other critical keys which
    may be required to make a number
    */
    if (!MenuBar.isValidDigitKeyEvent(e)) {
      e.preventDefault();
    }
  };

  handleClipPercentileMinValueChange = (v) => {
    /*
    Ignore anything that isn't a legit number
    */
    if (!Number.isFinite(v)) return;

    const { pendingClipPercentiles } = this.state;
    const clipPercentileMax = pendingClipPercentiles?.clipPercentileMax;

    /*
    clamp to [0, currentClipPercentileMax]
    */
    if (v <= 0) v = 0;
    if (v > 100) v = 100;
    const clipPercentileMin = Math.round(v); // paranoia
    this.setState({
      pendingClipPercentiles: { clipPercentileMin, clipPercentileMax },
    });
  };
  onSliderChange = ( value ) => {
    const { dispatch } = this.props;
    dispatch({type: "sankey: set alignment score threshold", threshold: value})
    this.setState({
      ...this.state,
      threshold: value
    })    
  }

  onRelease = (value) => {
    const { dispatch } = this.props;
    const { samHVG, sankeyMethod, numGenes, dataLayer, geneMetadata, numEdges } = this.state;
    dispatch({type: "sankey: set alignment score threshold", threshold: value})
    this.handleSankey(value,false,{samHVG,sankeyMethod,numGenes,dataLayer, geneMetadata, numEdges})
    this.setState({
      ...this.state,
      threshold: value
    })    
  }
  handleClipPercentileMaxValueChange = (v) => {
    /*
    Ignore anything that isn't a legit number
    */
    if (!Number.isFinite(v)) return;

    const { pendingClipPercentiles } = this.state;
    const clipPercentileMin = pendingClipPercentiles?.clipPercentileMin;

    /*
    clamp to [0, 100]
    */
    if (v < 0) v = 0;
    if (v > 100) v = 100;
    const clipPercentileMax = Math.round(v); // paranoia

    this.setState({
      pendingClipPercentiles: { clipPercentileMin, clipPercentileMax },
    });
  };

  handleClipCommit = () => {
    const { dispatch } = this.props;
    const { pendingClipPercentiles } = this.state;
    const { clipPercentileMin, clipPercentileMax } = pendingClipPercentiles;
    const min = clipPercentileMin / 100;
    const max = clipPercentileMax / 100;
    dispatch(actions.clipAction(min, max));
  };

  handleClipOpening = () => {
    const { clipPercentileMin, clipPercentileMax } = this.props;
    this.setState({
      pendingClipPercentiles: { clipPercentileMin, clipPercentileMax },
    });
  };

  handleClipClosing = () => {
    this.setState({ pendingClipPercentiles: null });
  };

  handleCentroidChange = () => {
    const { dispatch, showCentroidLabels } = this.props;

    dispatch({
      type: "show centroid labels for category",
      showLabels: !showCentroidLabels,
    });
  };

  handleSubset = () => {
    const { dispatch } = this.props;
    dispatch(actions.subsetAction());
  };

  handleSubsetReset = () => {
    const { dispatch } = this.props;
    dispatch(actions.resetSubsetAction());
  };

  render() {
    const {
      dispatch,
      annoMatrix,
      disableDiffexp,
      undoDisabled,
      redoDisabled,
      selectionTool,
      clipPercentileMin,
      clipPercentileMax,
      graphInteractionMode,
      showCentroidLabels,
      categoricalSelection,
      colorAccessor,
      subsetPossible,
      subsetResetPossible,
      displaySankey,
      layoutChoice,
      outputController,
      sankeyController,
      currCacheKey,
      maxLink,
      userLoggedIn,
      tooManyCells,
      var_keys,
      geneSelection,
      pointScaler,
      chromeKeyContinuous,
      chromeKeyCategorical,
      chromeKeys,
      jointEmbeddingFlag
    } = this.props;
    const { preferencesDialogOpen, pendingClipPercentiles, threshold, saveDataWarningDialogOpen, revealSankeyDialog, sankeyMethod, numEdges, numGenes, samHVG, dataLayer, geneMetadata } = this.state;
    const isColoredByCategorical = !!categoricalSelection?.[colorAccessor];
    const loading = !!outputController?.pendingFetch;
    const loadingSankey = !!sankeyController?.pendingFetch;
    // constants used to create selection tool button
    const [selectionTooltip, selectionButtonIcon] =
      selectionTool === "brush"
        ? ["Brush selection", "Lasso selection"]
        : ["select", "polygon-filter"];

    return (
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          display: "flex",
          flexDirection: "row-reverse",
          alignItems: "flex-end",
          flexWrap: "wrap",
          justifyContent: "flex-end",
          zIndex: 10000000000000,
        }}
      >
        <Tooltip
          content="Preferences"
          position="bottom"
          hoverOpenDelay={globals.tooltipHoverOpenDelay}
        >
          <AnchorButton className={styles.menubarButton} icon="cog"
            onClick={()=>{this.setState({preferencesDialogOpen: true})}}
          />
        </Tooltip>        
        <Dialog
          title="Preferences"
          isOpen={preferencesDialogOpen}
          onClose={()=>{this.setState({preferencesDialogOpen: false})}}
          onOpened={()=>{
            d3.select("#categorical_legend_preferences").selectAll("*").remove();
            continuous(
              "#categorical_legend_preferences",
              d3.scaleSequential(chromatic[`interpolate${chromeKeyCategorical}`]).domain([0,1])
            );   
        
            d3.select("#continuous_legend_preferences").selectAll("*").remove();
            continuous(
              "#continuous_legend_preferences",
              d3.scaleSequential(chromatic[`interpolate${chromeKeyContinuous}`]).domain([0,1])
            );            
          }}
        >
          <div style={{
            margin: "0 auto",
            paddingTop: "10px",
            width: "90%"
          }}>
            <ControlGroup fill={true} vertical={false}>
              <Checkbox checked={jointEmbeddingFlag} label="Display joint embedding"
                  onChange={() => {    
                    dispatch({
                      type: "set display joint embedding flag",
                      value: !jointEmbeddingFlag
                      })
                    }
                  } 
              />               
            </ControlGroup>

            <ControlGroup fill={true} vertical={false}>
              <span style={{width: "160px", paddingRight: "10px"}}>Point size scaler:</span>
              <Slider
                min={0.0}
                max={10.0}
                stepSize={0.01}
                labelStepSize={5.0}
                showTrackFill={false}
                onChange={(value)=>{
                  dispatch({type: "set point scaler", scaler: Math.max(0.01,value)})}}
                value={pointScaler}
              />
            </ControlGroup>
            <div style={{paddingTop: "20px", paddingBottom: "5px"}}>
                <b>Categorical colorscale:</b>
            </div>            
            <ControlGroup fill={true} vertical={false}>
              <Select
                items={
                  chromeKeys
                }
                filterable={false}
                itemRenderer={(d, { handleClick }) => {
                  return (
                    <MenuItem
                      onClick={handleClick}
                      key={d}
                      text={d}
                    />
                  );
                }}
                onItemSelect={(d) => {
                  dispatch({type: "set chrome key categorical", key: d})
                }}
              >
                <AnchorButton
                  text={`${chromeKeyCategorical}`}
                  rightIcon="double-caret-vertical"
                />
              </Select>  
              <div
                id="categorical_legend_preferences"
              />                           
            </ControlGroup>            
            <div style={{paddingTop: "20px", paddingBottom: "5px"}}>
                <b>Continuous colorscale:</b>
            </div>
            <ControlGroup fill={true} vertical={false}>
              <Select
                items={
                  chromeKeys
                }
                filterable={false}
                itemRenderer={(d, { handleClick }) => {
                  return (
                    <MenuItem
                      onClick={handleClick}
                      key={d}
                      text={d}
                    />
                  );
                }}
                onItemSelect={(d) => {
                  dispatch({type: "set chrome key continuous", key: d})
                }}
              >
                <AnchorButton
                  text={`${chromeKeyContinuous}`}
                  rightIcon="double-caret-vertical"
                />
              </Select> 
              <div
                id="continuous_legend_preferences"
              />
            </ControlGroup>
          </div>
        </Dialog>        
        <UndoRedoReset
          dispatch={dispatch}
          undoDisabled={undoDisabled}
          redoDisabled={redoDisabled}
        />
        {false && <Clip
          pendingClipPercentiles={pendingClipPercentiles}
          clipPercentileMin={clipPercentileMin}
          clipPercentileMax={clipPercentileMax}
          handleClipOpening={this.handleClipOpening}
          handleClipClosing={this.handleClipClosing}
          handleClipCommit={this.handleClipCommit}
          isClipDisabled={this.isClipDisabled}
          handleClipOnKeyPress={this.handleClipOnKeyPress}
          handleClipPercentileMaxValueChange={
            this.handleClipPercentileMaxValueChange
          }
          handleClipPercentileMinValueChange={
            this.handleClipPercentileMinValueChange
          }
        />}
        {userLoggedIn && <ButtonGroup className={styles.menubarButton} style={{zIndex: 100000000000}}>
          <Reembedding />
        </ButtonGroup>}
        {false && <Tooltip
          content="When a category is colored by, show labels on the graph"
          position="bottom"
          disabled={graphInteractionMode === "zoom"}
          hoverOpenDelay={globals.tooltipHoverOpenDelay}
        >
          <AnchorButton
            className={styles.menubarButton}
            type="button"
            data-testid="centroid-label-toggle"
            icon="property"
            onClick={this.handleCentroidChange}
            active={showCentroidLabels}
            intent={showCentroidLabels ? "primary" : "none"}
            disabled={!isColoredByCategorical}
          />
        </Tooltip>}
        <ButtonGroup className={styles.menubarButton}>
          <Tooltip
            content={
              selectionTooltip === "select"
                ? "Lasso selection"
                : selectionTooltip
            }
            position="bottom"
            hoverOpenDelay={globals.tooltipHoverOpenDelay}
          >
            <AnchorButton
              type="button"
              data-testid="mode-lasso"
              icon={selectionButtonIcon}
              active={graphInteractionMode === "select"}
              onClick={() => {
                dispatch({
                  type: "change graph interaction mode",
                  data: "select",
                });
              }}
              disabled={layoutChoice.sankey}
            />
          </Tooltip>
          <Tooltip
            content="Drag to pan, scroll to zoom"
            position="bottom"
            hoverOpenDelay={globals.tooltipHoverOpenDelay}
          >
            <AnchorButton
              type="button"
              data-testid="mode-pan-zoom"
              icon="zoom-in"
              active={graphInteractionMode === "zoom"}
              onClick={() => {
                dispatch({
                  type: "change graph interaction mode",
                  data: "zoom",
                });
              }}
              disabled={layoutChoice.sankey}
            />
          </Tooltip>
          <Tooltip
            content="Show metadata information for hovered cells"
            position="bottom"
            hoverOpenDelay={globals.tooltipHoverOpenDelay}
          >
            <AnchorButton
              type="button"
              icon="airplane"
              active={graphInteractionMode === "lidar"}
              onClick={() => {
                dispatch({
                  type: "change graph interaction mode",
                  data: "lidar",
                });
              }}
              disabled={layoutChoice.sankey}
            />       
          </Tooltip>
          {userLoggedIn && <Tooltip
            content="Display sankey plot from selected categories."
            position="bottom"
            hoverOpenDelay={globals.tooltipHoverOpenDelay}
          >            
            <AnchorButton
                type="button"
                icon="fork"
                active={layoutChoice.sankey}
                disabled={!displaySankey && !layoutChoice.sankey}
                loading={loadingSankey}
                onClick={() => {
                  if (layoutChoice.sankey) {
                    this.handleSankey(0,true)
                    dispatch({
                      type: "change graph interaction mode",
                      data: "select",
                    });
                  } else {
                    this.setState({
                      ...this.state,
                      revealSankeyDialog: true
                    })
                  }
                }}
              />           
            </Tooltip>}
    
        </ButtonGroup>
        <Subset
          subsetPossible={subsetPossible}
          subsetResetPossible={subsetResetPossible}
          handleSubset={this.handleSubset}
          handleSubsetReset={this.handleSubsetReset}
        />
        {(disableDiffexp || !userLoggedIn) ? null : <DiffexpButtons />}
        <ButtonGroup className={styles.menubarButton}>        
        <Tooltip
            content="Click to display hotkey menu ( or SHIFT+?)"
            position="bottom"
            hoverOpenDelay={globals.tooltipHoverOpenDelay}
          >            
            <AnchorButton
                type="button"
                icon="key"
                onClick={() => {
                  this.setState({...this.state, hotkeysDialogOpen: !this.state.hotkeysDialogOpen})
                }}
              />           
        </Tooltip>
        </ButtonGroup>
        <HotkeysDialog open={this.state.hotkeysDialogOpen}/>
        {userLoggedIn &&<Dialog
        title="Warning: Saving more than 50k cells"
        isOpen={saveDataWarningDialogOpen}
        onClose={this.dismissWarningDialog}
      >
        <div style={{
          display: "flex",
          margin: "0 auto",
          paddingTop: "10px"
        }}>
        <div
        style={{fontSize: "16px", paddingRight: "10px", margin: "auto 0"}}
        >Data output may take a long time. Proceed?</div>
        <AnchorButton
          type="button"
          intent="danger"
          icon="warning-sign"
          onClick={() => {
            dispatch(actions.downloadData())
            this.setState({...this.state, saveDataWarningDialogOpen: false})
          }}
        > OK </AnchorButton>         
        </div>
        </Dialog>}  
        <Dialog
          title="Sankey plot options"
          isOpen={revealSankeyDialog}
          onClose={()=>{
            this.setState({...this.state, revealSankeyDialog: false})
            }
          }
        > 
          <div style={{paddingLeft: "10px", paddingTop: "10px"}}>
            <ControlGroup fill={true} vertical={false}>
              <StateParameterInput 
                label="Method"
                value={sankeyMethod}
                options={["Graph alignment", "Co-labeling", "Correlation","Correlation (selected genes)"]}
                tooltipContent={"Method to compute the sankey edges."}
                setter={(d)=>{this.setState({sankeyMethod: d})}}
              />       
              <StateParameterInput 
                min={1}
                max={annoMatrix.nObs}
                label="Max # edges"
                value={numEdges}
                setter={(d)=>{this.setState({numEdges: d})}}
                tooltipContent={`The maximum number of edges to show per label.`}
              />             
            </ControlGroup>
            {sankeyMethod === "Correlation" && <div style={{paddingTop: "10px"}}>
              <ControlGroup fill={true} vertical={false}>
                  <StateParameterInput 
                    label={<b>Sort by metadata?</b>}
                    value={samHVG}
                    tooltipContent={"Check to use existing gene metadata for feature selection."}
                    setter={()=>this.setState({samHVG: !samHVG})}
                  />   
                  <StateParameterInput
                    label="Metadata"
                    value={geneMetadata}
                    options={var_keys}
                    tooltipContent={"The metadata to use for feature selection."}
                    left
                    setter={(d)=>{this.setState({geneMetadata: d})}}
                  />                     
              </ControlGroup>
              <ControlGroup fill={true} vertical={false}>
                  <StateParameterInput
                    min={2}
                    max={annoMatrix.nVar}
                    label={`n_top_genes (${samHVG ? `${geneMetadata}` : "scanpy HVG"})`}
                    value={numGenes}
                    setter={(d)=>{this.setState({numGenes: d})}}
                    tooltipContent={`The number of genes to select using ${samHVG ? `${geneMetadata}` : "scanpy HVG"}.`}
                  />   
                  <StateParameterInput
                    label="Data layer"
                    value={dataLayer}
                    options={annoMatrix.schema.layers}
                    tooltipContent={"Expression layer on which correlations will be computed."}
                    left
                    setter={(d)=>{this.setState({dataLayer: d})}}
                  />      
                </ControlGroup>                    

            </div>} 
            {sankeyMethod === "Correlation (selected genes)" && <div style={{paddingTop: "10px"}}>
              <ControlGroup fill={true} vertical={false}>
                  <StateParameterInput
                    label="Data layer"
                    value={dataLayer}
                    options={annoMatrix.schema.layers}
                    tooltipContent={"Expression layer on which correlations will be computed."}
                    left
                    setter={(d)=>{this.setState({dataLayer: d})}}
                  />      
                </ControlGroup>                    

            </div>}             
            <div style={{textAlign: "right", paddingTop: "20px",paddingRight: "10px"}}>
            <AnchorButton
                type="button"
                icon="fork"
                intent="primary"
                disabled={sankeyMethod === "Correlation (selected genes)" && geneSelection.length === 0}
                onClick={() => {
                  this.handleSankey(0,true, {sankeyMethod, samHVG, numGenes, dataLayer, geneMetadata, numEdges})
                  this.setState({revealSankeyDialog: false})
                  dispatch({
                    type: "change graph interaction mode",
                    data: "select",
                  });  
                  //TODO: unclear why above by itself breaks sometimes or if below fixes.
                  dispatch({
                    type: "change graph interaction mode",
                    data: "lidar",
                  });           
                  dispatch({
                    type: "change graph interaction mode",
                    data: "select",
                  });                                                     
                }}
              > Create sankey </AnchorButton>  
            </div>                     
          </div>
        </Dialog>              
        {userLoggedIn && <ButtonGroup className={styles.menubarButton}>   
          <Tooltip
            content="Save current subset to an `.h5ad` file."
            position="bottom"
            hoverOpenDelay={globals.tooltipHoverOpenDelay}
          >                                              
            <AnchorButton
                type="button"
                icon="floppy-disk"
                intent={tooManyCells ?"danger" : "none"}
                loading={loading}
                onClick={() => {
                  this.handleSaveData()
                }}
              /> 
            </Tooltip>               
          </ButtonGroup>}

        <div style={{paddingTop: "10px", flexBasis: "100%", height: 0}}></div>
        {(userLoggedIn &&layoutChoice.sankey) ? 
        <div style={{
          width: "20%",
          textAlign: "right",
          display: "flex",
          justifyContent: "right",
        }}>
          <AnchorButton
          type="button"
          onClick={()=>{
            dispatch({type: "sankey: clear cached result",key: currCacheKey})
            this.handleSankey(threshold,false,{samHVG, sankeyMethod, numGenes, dataLayer, geneMetadata, numEdges})
          }}
          intent="primary"
          disabled={loadingSankey}
        >
          Recalculate sankey
        </AnchorButton>
        <div style={{paddingLeft: "10px"}}>
        <Tooltip
          content="Screenshot the current sankey plot"
          position="bottom"
          hoverOpenDelay={globals.tooltipHoverOpenDelay}
        >
        <AnchorButton
          type="button"
          disabled={loadingSankey}
          icon="camera"
          id="saveSankeyButton"
        /></Tooltip></div>
         </div> : <div style={{
          width: "20%",
          textAlign: "left",
          display: "flex",
          justifyContent: "left",
          flexDirection: "row",
          paddingLeft: "8px"
        }}>
          <Tooltip
          content="Screenshot the current embedding"
          position="bottom"
          hoverOpenDelay={globals.tooltipHoverOpenDelay}
        ><AnchorButton
        type="button"
        icon="camera"
        onClick={()=>{
          dispatch({type: "graph: screencap start"})
        }}
      /></Tooltip>
        
         </div> } 
        {layoutChoice.sankey ? 
        <div style={{
          width: "80%",
          paddingLeft: "50px",
          paddingRight: "20px",
          textAlign: "left",
          whiteSpace: "nowrap",
          margin: "0 auto",
          justifyContent: "space-between",
          display: "flex"
        }}>
          <div style={{paddingRight: "15px"}}>{<Tooltip
          content="Edges with weights below this threshold are filtered out."
          position="bottom"
          hoverOpenDelay={globals.tooltipHoverOpenDelay}          
          style={{
            width: "inherit"
          }}
        >Edge threshold:</Tooltip>}</div> 
          <div style={{
            width: "inherit"
          }}>
        <Slider
        min={0}
        max={maxLink}
        stepSize={Math.max(parseFloat((maxLink/100).toFixed(2)),0.001)}
        labelStepSize={Math.max(maxLink,0.001)}
        showTrackFill={false}
        onRelease={this.onRelease}
        onChange={this.onSliderChange}
        value={threshold}
      />
           </div></div>: null}         
      </div>
    );
  }
}

export default MenuBar;
