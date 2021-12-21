import React from "react";
import { connect } from "react-redux";
import { Button, Icon, Collapse, H4, AnchorButton } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import ParameterInput from "../menubar/parameterinput";
import GeneSet from "./geneSet";
import { GenesetHotkeys } from "../hotkeys";
import actions from "../../actions";
import Truncate from "../util/truncate"
import CreateGenesetDialogue from "./menus/createGenesetDialogue";
import * as globals from "../../globals";
import { AnnoMatrixLoader, AnnoMatrixObsCrossfilter } from "../../annoMatrix";
import QuickGene from "./quickGene";

@connect((state) => {
  return {
    allGenes: state.controls.allGenes.__columns[0],
    colorAccessor: state.colors.colorAccessor,
    genesets: state.genesets.genesets,
    annoMatrix: state.annoMatrix,
    reembedParams: state.reembedParameters,
    userLoggedIn: state.controls.userInfo ? true : false
  };
})
class GeneExpression extends React.Component {
  constructor(props){
    super(props);
    this.state={geneSetsExpanded: true};
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
  
  handleExpandGeneSets = () => {
    this.setState({
      ...this.state,
      geneSetsExpanded: !this.state.geneSetsExpanded,
    });
  };

  componentDidUpdate(prevProps) {
    const { dispatch, reembedParams, annoMatrix } = this.props;
    if(prevProps.reembedParams.dataLayerExpr !== reembedParams.dataLayerExpr){
      // Trigger new data layer.
      const baseDataUrl = `${globals.API.prefix}${globals.API.version}`;
      const annoMatrixNew = new AnnoMatrixLoader(baseDataUrl, annoMatrix.schema);
      annoMatrixNew.setLayer(reembedParams.dataLayerExpr)
      const obsCrossfilterNew = new AnnoMatrixObsCrossfilter(annoMatrixNew);
      actions.prefetchEmbeddings(annoMatrixNew);

      dispatch({
        type: "annoMatrix: init complete",
        annoMatrix: annoMatrixNew,
        obsCrossfilter: obsCrossfilterNew
      });      
    } else if(prevProps.reembedParams.logScaleExpr !== reembedParams.logScaleExpr){
      const baseDataUrl = `${globals.API.prefix}${globals.API.version}`;
      const annoMatrixNew = new AnnoMatrixLoader(baseDataUrl, annoMatrix.schema);
      annoMatrixNew.setLogscale(reembedParams.logScaleExpr)
      const obsCrossfilterNew = new AnnoMatrixObsCrossfilter(annoMatrixNew);
      actions.prefetchEmbeddings(annoMatrixNew);

      dispatch({
        type: "annoMatrix: init complete",
        annoMatrix: annoMatrixNew,
        obsCrossfilter: obsCrossfilterNew
      });      
    }
  }

  handleActivateCreateGenesetMode = () => {
    const { dispatch } = this.props;
    dispatch({ type: "geneset: activate add new geneset mode" });
  };

  render() {
    const { dispatch, genesets, annoMatrix, userLoggedIn } = this.props;
    const { geneSetsExpanded } = this.state;
    return (
      <div>
       {userLoggedIn ?  <GenesetHotkeys
          dispatch={dispatch}
          genesets={genesets}
        /> : null}
        <div style={{
          marginBottom: "20px",
          textAlign: "right",
          display: "flex",
          justifyContent: "right",
        }}>
            <ParameterInput
              label="Log scale"
              param="logScaleExpr"
              tooltipContent={"Check to display expressions in log scale."}
              left
            />               
          <div style={{paddingLeft: "10px"}}>
            <ParameterInput
              label="Data layer"
              param="dataLayerExpr"
              options={annoMatrix.schema.layers}
              tooltipContent={"Expression layer used for visualization and differential expression."}
              left
            /> 
          </div>     
        </div>               
        <QuickGene/>
        <div>
          <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between" }}>
            <H4
              role="menuitem"
              tabIndex="0"
              data-testclass="geneset-heading-expand"
              style={{
                cursor: "pointer",
              }}
              onClick={this.handleExpandGeneSets}
            >
              Gene Sets{" "}
              {geneSetsExpanded ? (
                <Icon icon={IconNames.CHEVRON_DOWN} />
              ) : (
                <Icon icon={IconNames.CHEVRON_RIGHT} />
              )}
            </H4>        
            <div style={{
              marginBottom: 10, position: "relative", top: -2
            }}>
            <Button
              data-testid="open-create-geneset-dialog"
              onClick={this.handleActivateCreateGenesetMode}
              intent="primary"
              disabled={!userLoggedIn}
            >
              Create new
            </Button>
            </div>    
          </div>
          <CreateGenesetDialogue />

          { 
            geneSetsExpanded && <div>{this.renderGeneSets()}</div>
          }
        </div>
      </div>
    );
  }
}

export default GeneExpression;
