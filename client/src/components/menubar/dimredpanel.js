import React from "react";
import { connect } from "react-redux";
import {
  Button,
  AnchorButton,
  Collapse,
  ControlGroup,
  InputGroup,
  RadioGroup,
  Radio,
  Position,
  Tooltip
} from "@blueprintjs/core";
import * as globals from "../../globals";
import ParameterInput from "./parameterinput";
import BatchPanel from "./batchpanel";

function writableAnnotationsObs(annoMatrix) {
  return annoMatrix.schema.annotations.obs.columns
    .filter((s) => s.writable)
    .map((s) => s.name);
}
function writableAnnotationsVar(annoMatrix) {
  return annoMatrix.schema.annotations.var.columns
    .filter((s) => s.writable)
    .map((s) => s.name);
}

@connect((state) => ({
  reembedParams: state.reembedParameters,
  annoMatrix: state.annoMatrix,
  currentLayout: state.layoutChoice.current,
  varRefresher: state.controls.varRefresher,
  cxgMode: state.controls.cxgMode,
  jointMode: state.controls.jointMode
}))
class DimredPanel extends React.PureComponent {
  constructor(props) {
    super(props);
    this.state = {
      cfshown: false,
      gfshown: false,
      hvgshown: props.reembedParams.embeddingMode === "Run UMAP",
      samshown: false,
      trshown: false,
      aboDisabled: props.reembedParams.embeddingMode === "Run UMAP",
      allDisabled: props.reembedParams.embeddingMode === "Create embedding from subset"
    };
  }
  
  componentDidMount = () => {
    const { dispatch, annoMatrix, currentLayout, reembedParams } = this.props;
    const { embeddingMode } = reembedParams;

    const lS = annoMatrix.schema.latent_spaces;
    const latentSpaces = [];
    lS.forEach((item)=>{
      if (item.includes(`;;${currentLayout}`) && !item.includes(`;;${currentLayout};;`)){
        const n = item.split(';;').at(0);
        if (!latentSpaces.includes(n)){
          latentSpaces.push(n)
        }
      } else if(!item.includes(';;')) {
        if (!latentSpaces.includes(item)){
          latentSpaces.push(item)
        }        
      }
    })
    if (latentSpaces.length === 0 && embeddingMode === "Run UMAP") {
      dispatch({type: "reembed: set parameter", key: "embeddingMode", value: "Preprocess and run"})
    }       
  }
  componentDidUpdate = (prevProps) => {
    const { reembedParams } = this.props;
    const { embeddingMode } = reembedParams;
     

    if (embeddingMode !== prevProps.reembedParams.embeddingMode) {
      if (embeddingMode === "Run UMAP") {
        this.setState({
          cfshown: false,
          gfshown: false,
          hvgshown: true,
          samshown: false,
          trshown: false,
          aboDisabled: true,
          allDisabled: false
        })
      } else if (embeddingMode === "Preprocess and run" || embeddingMode === "Cell and gene embedding") {
        this.setState({
          cfshown: false,
          gfshown: false,
          hvgshown: false,
          samshown: false,
          trshown: false,          
          aboDisabled: false,
          allDisabled: false
        })
      } else if (embeddingMode === "Create embedding from subset") {
        this.setState({
          cfshown: false,
          gfshown: false,
          hvgshown: false,
          samshown: false,
          trshown: false,          
          aboDisabled: false,
          allDisabled: true
        })
      }
    }
  }
  
  render() {
    const {
      cfshown, gfshown, hvgshown, samshown, trshown, aboDisabled, allDisabled
    } = this.state;
    const { reembedParams, annoMatrix, dispatch, cxgMode, embName, onChange, currentLayout } = this.props;
    const lS = annoMatrix.schema.latent_spaces;
    const dsampleOptions = cxgMode === "VAR" ? writableAnnotationsVar(annoMatrix) : writableAnnotationsObs(annoMatrix)
    const latentSpaces = [];
    lS.forEach((item)=>{
      if (item.endsWith(`;;${currentLayout}`)){
        const n = item.split(';;').at(0);
        if (!latentSpaces.includes(n)){
          latentSpaces.push(n)
        }
      } else if(!item.includes(';;')) {
        if (!latentSpaces.includes(item)){
          latentSpaces.push(item)
        }        
      }
    })
    const cOrG = cxgMode === "OBS" ? "cell" : "gene";
    const gOrC = cxgMode !== "OBS" ? "cell" : "gene";
    const disabled = allDisabled || aboDisabled;
    const advancedShown = this.state?.advancedShown ?? false;
    let tem;
    if (allDisabled){
      tem = "`Create embedding from subset` copies the current selection into a new embedding.";
    } else if (aboDisabled) {
      tem = "`Run UMAP` runs UMAP on an existing latent space (e.g. PCA).";
    } else {
      tem = "`Preprocess and run` ";
    }
    return (
      <div>
      <div
      style={{
        paddingBottom: "10px",
        paddingTop: "10px"
      }}>
      <InputGroup
          id="emb-name-input"
          placeholder="New embedding name..."
          onChange={onChange}
          value={embName}
      />
      </div>
      <hr/>
      <div style={{"margin":"auto 0", paddingTop: "10px"}}>
      <ControlGroup fill={true} vertical={false}>    
      <RadioGroup
          label={<b>Select embedding mode</b>}
          onChange={(item)=>{
            dispatch({type: "reembed: set parameter", key: "embeddingMode", value: item.target.value})
          }}
          selectedValue={reembedParams.embeddingMode}
      
        >
            <Radio label={
                <Tooltip
                content="Execute the full analysis pipeline on the current selection."
                position={Position.BOTTOM}
                boundary="viewport"
                hoverOpenDelay={globals.tooltipHoverOpenDelay}
                modifiers={{
                  preventOverflow: { enabled: false },
                  hide: { enabled: false },
                }}
                targetTagName="span"
                wrapperTagName="span"
                >                   
                  Preprocess and run
                </Tooltip>
              } value="Preprocess and run"/>       
            
            <Radio label={
                <Tooltip
                content="Copy the current selection into a new embedding."
                position={Position.BOTTOM}
                boundary="viewport"
                hoverOpenDelay={globals.tooltipHoverOpenDelay}
                modifiers={{
                  preventOverflow: { enabled: false },
                  hide: { enabled: false },
                }}
                targetTagName="span"
                wrapperTagName="span"
                >                   
                  Create embedding from subset
                </Tooltip>
              } value="Create embedding from subset"/>
          
          {latentSpaces.length > 0 ?
              <Radio label={
                <Tooltip
                content="Run UMAP on the current selection using precomputed latent spaces (e.g. PCA)."
                position={Position.BOTTOM}
                boundary="viewport"
                hoverOpenDelay={globals.tooltipHoverOpenDelay}
                modifiers={{
                  preventOverflow: { enabled: false },
                  hide: { enabled: false },
                }}
                targetTagName="span"
                wrapperTagName="span"
                >  
                  Run UMAP
                </Tooltip>    
              } value="Run UMAP"/> 
            : null}
              <Radio label={
                <Tooltip
                content="Calculate a joint embedding for both cells and genes."
                position={Position.BOTTOM}
                boundary="viewport"
                hoverOpenDelay={globals.tooltipHoverOpenDelay}
                modifiers={{
                  preventOverflow: { enabled: false },
                  hide: { enabled: false },
                }}
                targetTagName="span"
                wrapperTagName="span"
                >  
                  Cell and gene embedding
                </Tooltip>    
              } value="Cell and gene embedding"/>            
          </RadioGroup>
          <ControlGroup vertical={true}>
          {(cxgMode === "VAR" && annoMatrix.nVar > 50000 &&
        (reembedParams.embeddingMode==="Preprocess and run" || reembedParams.embeddingMode==="Cell and gene embedding")
       ) &&        
        <ParameterInput
            label="Downsample cells by"
            param="dsampleKey"
            tooltipContent={"Select labels to uniformly downsample cells from."}
            options={["None",...dsampleOptions]}
          />}  
          {(reembedParams.embeddingMode==="Cell and gene embedding") && <ParameterInput
            label={`Scale ${cOrG} connectivities by`}
            param="cellScaler"
            tooltipContent={`Internal ${cOrG} connectivities will be scaled by this number.`}
            min={0}
            max={1.0}
          />}  
          {(reembedParams.embeddingMode==="Cell and gene embedding") && <ParameterInput
            label={`Scale ${gOrC} connectivities by`}
            param="geneScaler"
            tooltipContent={`Internal ${gOrC} connectivities will be scaled by this number.`}
            min={0}
            max={1.0}
          />}
          {(reembedParams.embeddingMode==="Cell and gene embedding") && <ParameterInput
            label={`Number of cell-gene edges`}
            param="knnCross"
            tooltipContent={`Determines the number of edges drawn between cells and genes in the joint graph.`}
            min={0}
          />}        
          </ControlGroup>                                     
        </ControlGroup>        
      </div>  
      <div style={{paddingTop: "30px"}}>
        <Button
          onClick={() => {
            this.setState({ 
              advancedShown: !(this.state?.advancedShown ?? false)
            });
          }}
          minimal
          rightIcon={advancedShown ? "chevron-down" : "chevron-right"} small
        >
          {<b>Advanced options</b>}
        </Button>
      </div>  
      <Collapse isOpen={advancedShown || aboDisabled}>   
      {allDisabled || cxgMode === "VAR" || reembedParams.embeddingMode === "Cell and gene embedding" ? null :
      <div
      style={{
        paddingBottom: "10px",
        paddingTop: "10px"
      }}>
        <BatchPanel disabled={allDisabled}/>           
      </div>
      }
      {disabled ? null : <ControlGroup fill={true} vertical={false}>       
      <ParameterInput
          label="Kernel PCA?"
          param="kernelPca"
          tooltipContent={"Use kernel PCA for nonlinear dimensionality reduction."}
          disabled={disabled}
        />            
        <ParameterInput
          label="Scale data?"
          param="scaleData"
          tooltipContent={"Scale the data such that genes have zero mean and unit variance prior to PCA."}
          disabled={disabled}
        />             
      </ControlGroup>}
      {disabled ? null : <AnchorButton
        onClick={() => {
          this.setState({ 
            ...this.state,
            trshown: !this.state.trshown,
          });
        }}
        text={<b>Highly variable gene selection</b>}
        minimal fill
        rightIcon={trshown ? "chevron-down" : "chevron-right"} small
        disabled = {disabled}
      />}   
      <div style={{"paddingLeft":"10px"}}>
        <Collapse isOpen={trshown}>   
        {(!reembedParams.doSAM || cxgMode === "OBS") && <ControlGroup fill={true} vertical={false}>
          {!reembedParams.doSAM && <ParameterInput 
              label="Use SAM weights?"
              param="samHVG"
              tooltipContent={"Check to use SAM weights for feature selection."}
              disabled={disabled}
            />}   
            {(cxgMode === "OBS" && reembedParams.embeddingMode === "Cell and gene embedding") && <ParameterInput 
              label="Use HVGs for the joint embedding"
              param="jointHVG"
              tooltipContent={"Check to only display HVGs for the joint embedding."}
              disabled={disabled}
            />}            
          </ControlGroup>}
          <ControlGroup fill={true} vertical={false}>
            <ParameterInput
              min={0}
              max={annoMatrix.nVar}
              label={`n_top_genes (${(reembedParams.samHVG || reembedParams.doSAM) ? "SAM weights" : "scanpy HVG"})`}
              param="nTopGenesHVG"
              tooltipContent={`The number of genes to select using ${(reembedParams.samHVG || reembedParams.doSAM)? "SAM weights" : "scanpy HVG"}.`}
            />        
          </ControlGroup>                    
        </Collapse>  
      </div>                 
      {disabled ? null : <AnchorButton
        onClick={() => {
          this.setState({ 
            ...this.state,
            cfshown: !this.state.cfshown,
          });
        }}
        text={reembedParams.kernelPca ? <b>Kernel PCA</b> : <b>PCA</b>}
        minimal fill
        rightIcon={cfshown ? "chevron-down" : "chevron-right"} small
        disabled={disabled}
      />}                    
      <div style={{"paddingLeft":"10px"}}>
        <Collapse isOpen={cfshown}>
          <ControlGroup fill={true} vertical={false}>
            <ParameterInput
            min={1}
            label="n_comps"
            param="numPCs"
            tooltipContent={"Number of top principal components to calculate."}
            />
            {false && <div style={{"margin":"auto 0"}}>
              <ParameterInput
              label="svd_solver"
              param="pcaSolver"
              options={["arpack","randomized","auto","lopcg"]}
              tooltipContent={"The SVD solver to use."}
              />   
            </div>}             
          </ControlGroup>
        </Collapse>
      </div>           
      {disabled ? null : <AnchorButton
        onClick={() => {
          this.setState({ 
            ...this.state,
            gfshown: !this.state.gfshown,
          });
        }}
        text={<b>Neighbors</b>}
        minimal fill
        disabled={disabled}
        rightIcon={gfshown ? "chevron-down" : "chevron-right"} small
      />}   
      <div style={{"paddingLeft":"10px"}}>
        <Collapse isOpen={gfshown}>
          <ControlGroup fill={true} vertical={false}>
            <ParameterInput
              min={1}
              label="n_neighbors"
              param="neighborsKnn"
              tooltipContent={"The number of nearest neighbors to compute."}
              />  
            <div style={{"margin":"auto 0"}}>
              <ParameterInput
                label="metric"
                param="distanceMetric"
                options={["euclidean","correlation","cosine"]}
                tooltipContent={"The distance metric for computing nearest neighbors."}
                />
            </div>
            <div style={{"margin":"auto 0"}}>
              <ParameterInput
                label="method"
                param="neighborsMethod"
                options={["umap","gauss","rapids"]}
                tooltipContent={"The method used for calculating nearest neighbor connectivities (unused when SAM is enabled)."}
                />   
              </div>                                    
            </ControlGroup>         
        </Collapse>
      </div>
      {disabled ? null : <AnchorButton
        onClick={() => {
          this.setState({ 
            ...this.state,
            samshown: !this.state.samshown,
          });
        }}
        text={<b>SAM</b>}
        minimal fill
        rightIcon={samshown ? "chevron-down" : "chevron-right"} small
        disabled = {disabled}
      />}   
      <div style={{"paddingLeft":"10px"}}>
        <Collapse isOpen={samshown}>    
          <ControlGroup fill={true} vertical={false}>
            <ParameterInput 
              label="Use SAM?"
              param="doSAM"
              tooltipContent={"Check to use the SAM algorithm for dimensionality reduction. SAM weights will be added to gene metadata."}
              disabled={disabled}
            />                      
            <ParameterInput 
              label="Calculate SAM weights?"
              param="calculateSamWeights"
              tooltipContent={"Check to calculate SAM weights and add them to the gene metadata."}
              disabled={disabled}
            />             
          </ControlGroup>
          <ControlGroup fill={true} vertical={false}>
            <ParameterInput
              label="num_norm_avg"
              param="nnaSAM"
              min={1}
              max={annoMatrix.schema.nVar}
              tooltipContent={"The top num_norm_avg dispersions averaged to determine the \
              normalization factor when calculating the weights."}
            />     
            <div style={{"margin":"auto 0"}}>
              <ParameterInput
                label="Weight mode"
                param="weightModeSAM"
                options={["rms","dispersion","combined"]}
                tooltipContent={"Determines how gene weights are calculated. 'rms' is most robust. \
                The others typically yield manifolds with higher granularity but can sometimes overcluster."}
              />    
            </div> 
          </ControlGroup>                 
        </Collapse>  
      </div>         
      {disabled ? null : <AnchorButton
        onClick={() => {
          this.setState({ 
            ...this.state,
            hvgshown: !this.state.hvgshown,
          });
        }}
        text={<b>UMAP</b>}
        minimal fill 
        disabled={allDisabled}
        rightIcon={hvgshown ? "chevron-down" : "chevron-right"} small
      />}   
      <div style={{"paddingLeft":"10px"}}>
        <Collapse isOpen={hvgshown}>     
          <ControlGroup fill={true} vertical={false}>
            {aboDisabled ? 
            <div style={{"margin":"auto 0"}}>
              <ParameterInput
                label="Latent space"
                param="latentSpace"
                options={latentSpaces}
                tooltipContent={"Minimum distance between points in the UMAP projection. Increase for less crowding."}
              />
            </div>            
            : 
            null} 
            {aboDisabled ?             
            <div style={{"margin":"auto 0"}}>
              <ParameterInput
                label="metric"
                param="distanceMetric"
                options={["euclidean","correlation","cosine"]}
                tooltipContent={"The distance metric for computing nearest neighbors."}
                />
            </div> : null}
            <ParameterInput
              min={0.0}
              label="min_dist"
              param="umapMinDist"
              tooltipContent={"Minimum distance between points in the UMAP projection. Increase for less crowding."}
            />        
          </ControlGroup>    
        </Collapse>  
      </div>   
      </Collapse>               
    </div>
    );
  }
}

export default DimredPanel;
