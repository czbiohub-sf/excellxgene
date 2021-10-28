import React from "react";
import { connect } from "react-redux";
import { Button, Icon, Collapse, Position, Tooltip, AnchorButton } from "@blueprintjs/core";
import ParameterInput from "../menubar/parameterinput";
import GeneSet from "./geneSet";
import { GenesetHotkeys } from "../hotkeys";
import actions from "../../actions";
import Truncate from "../util/truncate"
import LabelInput from "../labelInput";
import CreateGenesetDialogue from "./menus/createGenesetDialogue";
import * as globals from "../../globals";
import { AnnoMatrixLoader } from "../../annoMatrix";

@connect((state) => {
  return {
    allGenes: state.controls.allGenes.__columns[0],
    colorAccessor: state.colors.colorAccessor,
    genesets: state.genesets.genesets,
    annoMatrix: state.annoMatrix,
    reembedParams: state.reembedParameters
  };
})
class GeneExpression extends React.Component {
  constructor(props){
    super(props);
    this.state={queryGene: ""};
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
            <hr/>

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
  onQueryGeneChange = (e) => {
    this.setState({...this.state, queryGene: e})
  }  
  onQueryGeneSelect = (e) => {
    const { dispatch } = this.props;    
    this.setState({...this.state, queryGene: e})
    dispatch(actions.requestSingleGeneExpressionCountsForColoringPOST(e));
  }
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
  
  onColorChangeClick = () => {
    const { dispatch } = this.props;
    const { queryGene } = this.state;
    dispatch(actions.requestSingleGeneExpressionCountsForColoringPOST(queryGene));
  };

  handleActivateCreateGenesetMode = () => {
    const { dispatch } = this.props;
    dispatch({ type: "geneset: activate add new geneset mode" });
  };

  render() {
    const { dispatch, genesets, annoMatrix, colorAccessor, allGenes } = this.props;
    const { queryGene } = this.state;
    const isColorAccessor = colorAccessor === queryGene;
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
        <div style={{
          display: "flex"
        }}>
  
        <LabelInput
          labelSuggestions={allGenes}
          onChange={this.onQueryGeneChange}
          onSelect={this.onQueryGeneSelect}
          label={queryGene}
          geneComplete
          inputProps={{placeholder: "Search gene to color by its expression.", fill: true}}
          popoverProps={null}
        />          

        <Button
          minimal
          small
          onClick={this.onColorChangeClick}
          active={isColorAccessor}
          intent={isColorAccessor ? "primary" : "none"}
          icon={<Icon icon="tint" iconSize={16} />}
        />   

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
