import React from "react";
import { connect } from "react-redux";
import {
  ControlGroup,
} from "@blueprintjs/core";
import ParameterInput from "./parameterinput";
import { ControlsHelpers } from "../../util/stateManager";
import DefaultsButton from "./defaultsio";

@connect((state) => ({
  reembedParams: state.reembedParameters,
  annoMatrix: state.annoMatrix
}))
class BatchPanel extends React.PureComponent {
  
  render() {
    const { reembedParams, annoMatrix, dispatch } = this.props;
    const allCategoryNames = ControlsHelpers.selectableCategoryNames(
      annoMatrix.schema
    ).sort();
    const disabled = !reembedParams.doBatch
    let panel;
    switch (reembedParams.batchMethod) { 
      case "BBKNN": {
        panel = (
          <div style={{"paddingLeft":"10px"}}>
            <ParameterInput 
              min={1}
              label="neighbors_within_batch"
              param="bbknnNeighborsWithinBatch"
              tooltipContent={"Number of neighbors reported for each batch."}
            />                   
          </div>
        );
        break;
      } case "Scanorama": {
        panel = (
          <div style={{"paddingLeft":"10px"}}>
            <ControlGroup fill={true} vertical={false}>
              <ParameterInput 
                min={1}
                label="knn"
                param="scanoramaKnn"
                tooltipContent={"Number of neighbors to use for matching."}
              />     
              <ParameterInput 
                min={0}
                label="sigma"
                param="scanoramaSigma"
                tooltipContent={"Correction smoothing parameter on Gaussian kernel."}
              />      
            </ControlGroup>  
            <ControlGroup fill={true} vertical={false}>             
              <ParameterInput 
                min={0}
                max={1}
                label="alpha"
                param="scanoramaAlpha"
                tooltipContent={"Alignment score minimum cutoff."}
              />  
              <ParameterInput 
                min={0}
                label="batch_size"
                param="scanoramaBatchSize"
                tooltipContent={"Batch size used in alignment vector computation."}
              />                                                   
            </ControlGroup>
          </div>
        );
        break;
      } case "Harmony": {
        panel = (
          <div style={{"paddingLeft":"10px"}}>
            <ControlGroup fill={true} vertical={false}>

            </ControlGroup>
          </div>
        );
        break;
      } default: {
        panel = null;
      }
    }
    panel = reembedParams.doBatch ? panel : null;
    return (
      <div>
        <ControlGroup fill={true} vertical={false}>
          <ParameterInput 
            label="Batch correct?"
            param="doBatch"
            tooltipContent={"Check to perform batch correction."}
          />
          <ParameterInput 
            disabled={disabled}
            label="Method"
            param="batchMethod"
            options={["BBKNN","Harmony","Scanorama"]}
            tooltipContent={"The batch correction method."}
          />      
          <ParameterInput 
            disabled={disabled}        
            label="Batch key"
            param="batchKey"
            options={allCategoryNames}
            tooltipContent={"The categorical variable with the batches to be corrected."}
          />    
        </ControlGroup>  
      {panel}      
    </div>
    );
  }
}

export default BatchPanel;
