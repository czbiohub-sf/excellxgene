import React from "react";
import { connect } from "react-redux";
import {
  Button,
  AnchorButton,
  Collapse,
  ControlGroup,
} from "@blueprintjs/core";
import ParameterInput from "./parameterinput";
import { ControlsHelpers } from "../../util/stateManager";

@connect((state) => ({
  reembedParams: state.reembedParameters,
  annoMatrix: state.annoMatrix,
}))
class PrepPanel extends React.PureComponent {
  constructor(props) {
    super(props);
    this.state = {
      cfshown: false,
      gfshown: false,
      hvgshown: false,
      trshown: false
    };
  }  
  componentDidUpdate(prevProps) {
    const { reembedParams } = this.props;
    if (reembedParams.doPreprocess !== prevProps.reembedParams.doPreprocess && !reembedParams.doPreprocess) {
      this.setState({ 
        hvgshown: false,
        cfshown: false,
        gfshown: false,   
        trshown: false     
      });
    }
  }

  render() {
    const {
      cfshown, gfshown, hvgshown, trshown
    } = this.state;
    const { reembedParams, annoMatrix, dispatch} = this.props;
    const allCategoryNames = ControlsHelpers.selectableCategoryNames(
      annoMatrix.schema
    ).sort();
    let disabled = !reembedParams.doPreprocess
    const batchDisabled = !reembedParams.doBatchPrep
    let allBatchPrepLabels;
    let disabledBatchLabel = true;
    if (reembedParams.batchPrepKey !== ""){
      if (reembedParams.batchPrepLabel !== ""){
        disabled = !reembedParams.batchPrepParams[reembedParams.batchPrepKey][reembedParams.batchPrepLabel].doPreprocess
      }
      allBatchPrepLabels = annoMatrix.schema.annotations.obsByName?.[reembedParams.batchPrepKey]?.categories
      if(allBatchPrepLabels){
        allBatchPrepLabels = allBatchPrepLabels.filter(item => item !== "unassigned")
        disabledBatchLabel = false;
      }
    }
    const advancedShown = this.state?.advancedShown ?? false;
    allBatchPrepLabels = allBatchPrepLabels ?? [""]
    return (
      <div>
      <ControlGroup fill={true} vertical={false}>     
        <ParameterInput 
          label="Batch preprocess?"
          param="doBatchPrep"
          tooltipContent={"Check to use different preprocessing parameters for each batch."}
        />   
        <ParameterInput 
          disabled={batchDisabled}        
          label="Batch key"
          param="batchPrepKey"
          options={allCategoryNames}
          tooltipContent={"The categorical variable containing the batch information."}
        />
        <ParameterInput 
          disabled={batchDisabled || disabledBatchLabel}        
          label="Batch label"
          param="batchPrepLabel"
          options={allBatchPrepLabels}
          tooltipContent={"The batch for which the parameters will be set."}
        />              
      </ControlGroup>        
      <ControlGroup fill={true} vertical={false}>
        <ParameterInput 
          label="Preprocess?"
          param="doPreprocess"
          tooltipContent={"Check to perform preprocessing."}
        />    
        <ParameterInput
            label="Sum normalize?"
            param="sumNormalizeCells"
            tooltipContent={"Check to normalize cells to have median library size (assumes raw counts)."}
            disabled={(!reembedParams.doPreprocess && batchDisabled) || (!batchDisabled && !reembedParams.batchPrepParams?.[reembedParams.batchPrepKey]?.[reembedParams.batchPrepLabel]?.doPreprocess)}
          />            
          <ParameterInput
            label="Log transform?"
            param="logTransform"
            tooltipContent={"Check to log-transform your data (assumes raw counts)."}
            disabled={(!reembedParams.doPreprocess && batchDisabled) || (!batchDisabled && !reembedParams.batchPrepParams?.[reembedParams.batchPrepKey]?.[reembedParams.batchPrepLabel]?.doPreprocess)}
          />               
        <ParameterInput
          label="Data layer"
          param="dataLayer"
          options={annoMatrix.schema.layers}
          tooltipContent={"The gene expression layer to be used for preprocessing."}
        />                   
      </ControlGroup>  
 
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
          {<b>Advanced filtering options</b>}
        </Button>
      </div>  
      <Collapse isOpen={advancedShown}>                 
      <AnchorButton
        onClick={() => {
          this.setState({ 
            hvgshown: false,
            cfshown: !this.state.cfshown,
            gfshown: false,
            trshown: false
          });
        }}
        text={<b>Cell filtering</b>}
        fill minimal
        rightIcon={cfshown ? "chevron-down" : "chevron-right"} small
        disabled = {disabled}
      />                    
      <div style={{"paddingLeft":"10px"}}>
        <Collapse isOpen={cfshown && !disabled}>
          <ControlGroup fill={true} vertical={false}>
            <ParameterInput
            min={0}
            label="min_counts"
            param="minCountsCF"
            tooltipContent={"The minimum number of total gene counts."}
            />
            <ParameterInput
            min={0}
            label="min_genes"
            param="minGenesCF"
            tooltipContent={"The minimum number of detected genes."}
            />         
          </ControlGroup>
        </Collapse>
      </div>     
      <AnchorButton
        onClick={() => {
          this.setState({ 
            hvgshown: false,
            gfshown: !this.state.gfshown,
            cfshown: false,
            trshown: false
          });
        }}
        text={<b>Gene filtering</b>}
        fill minimal
        rightIcon={gfshown ? "chevron-down" : "chevron-right"} small
        disabled = {disabled}
      />   
      <div style={{"paddingLeft":"10px"}}>
        <Collapse isOpen={gfshown && !disabled}>
          <ControlGroup fill={true} vertical={false}>
            <ParameterInput
              min={0}
              label="min_counts"
              param="minCountsGF"
              tooltipContent={"The minimum number of total cell counts."}
              />        
            </ControlGroup>
            <ControlGroup fill={true} vertical={false}>
              <ParameterInput
              min={0}
              max={100}
              label="min_cells (%)"
              param="minCellsGF"
              tooltipContent={"The minimum % of cells expressing a gene."}
              />
              <ParameterInput
              min={0}
              max={100}
              label="max_cells (%)"
              param="maxCellsGF"
              tooltipContent={"The maximum % of cells expressing a gene."}
              />         
            </ControlGroup>          
        </Collapse>
      </div>    
      </Collapse>             
    </div>
    );
  }
}

export default PrepPanel;
