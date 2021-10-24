import React from "react";
import { connect } from "react-redux";
import { Button, ControlGroup, Collapse, AnchorButton } from "@blueprintjs/core";
import ParameterInput from "../menubar/parameterinput";
import GeneSet from "./geneSet";
import { GenesetHotkeys } from "../hotkeys";
import actions from "../../actions";
import Truncate from "../util/truncate"

import CreateGenesetDialogue from "./menus/createGenesetDialogue";
import * as globals from "../../globals";
import { AnnoMatrixLoader } from "../../annoMatrix";

@connect((state) => {
  return {
    genesets: state.genesets.genesets,
    annoMatrix: state.annoMatrix,
    reembedParams: state.reembedParameters
  };
})
class GeneExpression extends React.Component {
  constructor(props){
    super(props);
    this.state={};
  }

  renderGeneSets = () => {
    const sets = {};
    const { dispatch, genesets } = this.props;
    for (const [name, geneset] of genesets) {
      const id = geneset.genesetDescription
      const set = (
        <GeneSet
          key={name}
          setGenes={Array.from(geneset.genes.keys())}
          setGenesWithDescriptions={geneset.genes}
          displayLabel={name.split(' : (').at(0)}
          setName={name}
          genesetDescription={geneset.genesetDescription}
        />
      );
      if ( id in sets ){
        sets[id].push(set)
      } else {
        sets[id] = [set]
      }
    }
    const els = [];
    for ( const key in sets ){
      const groupName = key.split(';;').at(-1);
      els.push(
        <div key={key}>
            <div style={{
              display: "flex"
            }}>
            <AnchorButton
              onClick={() => {
                this.setState({ 
                  [groupName]: !(this.state[groupName]??false)
                });
              }}
              text={<Truncate><span>{groupName}</span></Truncate>}
              fill
              minimal
              rightIcon={(this.state[groupName]??false) ? "chevron-down" : "chevron-right"} small
            />        
            <AnchorButton
              icon="small-cross"
              minimal
              intent="danger"
              style={{
                cursor: "pointer",
              }}
              onClick={() => dispatch(actions.genesetDeleteGroup(key))}
            />   
          </div>         
          <Collapse isOpen={this.state[groupName]??false}>
            {sets[key]}
          </Collapse>
        </div>
      )
    }
    return els;
  };

  componentDidUpdate(prevProps) {
    const { dispatch, reembedParams, annoMatrix } = this.props;
    if(prevProps.reembedParams.dataLayerExpr !== reembedParams.dataLayerExpr){
      // Trigger new data layer.
      dispatch(actions.requestDataLayerChange(reembedParams.dataLayerExpr)).then(()=>{
        const baseDataUrl = `${globals.API.prefix}${globals.API.version}`;
        const annoMatrixNew = new AnnoMatrixLoader(baseDataUrl, annoMatrix.schema);
        dispatch({
          type: "",
          annoMatrix: annoMatrixNew
        });      
      })
    }
  }

  handleActivateCreateGenesetMode = () => {
    const { dispatch } = this.props;
    dispatch({ type: "geneset: activate add new geneset mode" });
  };

  render() {
    const { dispatch, genesets, annoMatrix } = this.props;
    return (
      <div>
        <GenesetHotkeys
          dispatch={dispatch}
          genesets={genesets}
        />
        <div>
          <div style={{ display: "flex", marginBottom: 10, justifyContent: "space-between", position: "relative", top: -2 }}>
            <Button
              data-testid="open-create-geneset-dialog"
              onClick={this.handleActivateCreateGenesetMode}
              intent="primary"
            >
              Create new <strong>gene set</strong>
            </Button>
            <ParameterInput
              label="Data layer"
              param="dataLayerExpr"
              options={annoMatrix.schema.layers}
              tooltipContent={"The gene expression layer used for visualization and differential expression."}
            />                   
                              
          </div>
          <CreateGenesetDialogue />
        </div>
        <div>
          { 
            this.renderGeneSets()
          }
        </div>
      </div>
    );
  }
}

export default GeneExpression;
