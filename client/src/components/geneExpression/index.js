import React from "react";
import { connect } from "react-redux";
import { Button, Icon, Collapse, H4, AnchorButton, Tooltip } from "@blueprintjs/core";
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
import AnnoDialog from "../annoDialog";
import LabelInput from "../labelInput";

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
    this.state={
      geneSetsExpanded: true,
      isEditingSetName: false,
      newNameText: "",
      nameBeingEdited: ""
    };
  }

  handleChangeOrSelect = (name) => {
    this.setState({
      newNameText: name,
    });
  };

  activateEditNameMode = (e, name) => {
    this.setState({
      newNameText: name,
      isEditingSetName: true,
      nameBeingEdited: name,
    })
    e.preventDefault();
  };
  disableEditNameMode = () => {
    this.setState({
      newNameText: "",
      isEditingSetName: false,
      nameBeingEdited: ""
    })
  };
  handleEditName = (e) => {
    const { dispatch } = this.props;
    const { newNameText, nameBeingEdited } = this.state

    const oldName = nameBeingEdited;
    const newName = newNameText;

    if (oldName !== newName) {
      dispatch(actions.requestRenameGeneset(oldName,newName))
    }
    this.disableEditNameMode()
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
            <Tooltip
            content="Edit geneset group name"
            position="top"
            hoverOpenDelay={globals.tooltipHoverOpenDelay}            
            >             
            <AnchorButton
              icon={<Icon icon="edit" iconSize={10} />}     
              minimal
              style={{
                cursor: "pointer",
              }}
              onClick={(e) => this.activateEditNameMode(e,groupName)}
              />  
            </Tooltip>                 
            <Tooltip
            content="Delete geneset group"
            position="top"
            hoverOpenDelay={globals.tooltipHoverOpenDelay}            
            >
            <AnchorButton
              icon={<Icon icon="trash" iconSize={10} />}     
              minimal
              intent="danger"
              style={{
                cursor: "pointer",
              }}
              onClick={() => dispatch(actions.genesetDeleteGroup(key))}
            />    
            </Tooltip>                        
          </div>         
          <Collapse isOpen={this.state[groupName]??false}>
            {sets[key]}
          </Collapse>
        </div>
      )
    }
    return els;
  };
  
  handleSaveGenedata = () => {
    const { dispatch } = this.props;
    dispatch(actions.downloadGenedata())
  } 

  handleExpandGeneSets = () => {
    this.setState({
      ...this.state,
      geneSetsExpanded: !this.state.geneSetsExpanded,
    });
  };
  
  /*createGeneset = (genesetName,genesArrayFromString,genesetDescription) => {
    const { dispatch } = this.props;

    dispatch({
      type: "geneset: create",
      genesetName,
      genesetDescription,
    });
    const genesTmpHardcodedFormat = [];

    genesArrayFromString.forEach((_gene) => {
      genesTmpHardcodedFormat.push({
        geneSymbol: _gene,
      });
    });

    dispatch(actions.genesetAddGenes(genesetName, genesTmpHardcodedFormat));

  };*/

  handleActivateCreateGenesetMode = () => {
    const { dispatch } = this.props;
    dispatch({ type: "geneset: activate add new geneset mode" });
  };

  render() {
    const { dispatch, genesets, annoMatrix, userLoggedIn } = this.props;
    const { geneSetsExpanded, isEditingSetName, newNameText, nameBeingEdited } = this.state;

    return (
      <div>
       {userLoggedIn ?  <GenesetHotkeys
          dispatch={dispatch}
          genesets={genesets}
        /> : null}

          <div style={{
            display: "flex",
            justifyContent: "left",
            textAlign: "left", 
            float: "left",
            paddingRight: "10px"
          }}>
                      
            {userLoggedIn && <Tooltip
              content="Save gene sets a `.csv` file."
              position="bottom"
              hoverOpenDelay={globals.tooltipHoverOpenDelay}
            >                                              
              <AnchorButton
                  type="button"
                  icon="floppy-disk"
                  onClick={() => {
                    this.handleSaveGenedata()
                  }}
                /> 
              </Tooltip> }  
            </div>       
            <div style={{
              marginBottom: "20px",
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
        {userLoggedIn && <div>
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
        </div>}
        {userLoggedIn && <AnnoDialog
          isActive={
            isEditingSetName
          }
          inputProps={{
            "data-testid": `edit-set-name-dialog`,
          }}
          primaryButtonProps={{
            "data-testid": `submit-set-name-edit`,
          }}
          title="Edit geneset group name"
          instruction={"Choose a new geneset group name"}
          cancelTooltipContent="Close this dialog without editing the name."
          primaryButtonText="Edit geneset group name"
          text={newNameText}
          handleSubmit={this.handleEditName}
          handleCancel={this.disableEditNameMode}
          validationError={newNameText==="" || newNameText===nameBeingEdited}
          annoInput={
            <LabelInput
              label={newNameText}
              inputProps={{
                "data-testid": `edit-set-name-text`,
                leftIcon: "tag",
                intent: "none",
                autoFocus: true,
              }}
              onChange={this.handleChangeOrSelect}
              onSelect={this.handleChangeOrSelect}                    
              newLabelMessage="New layout name"
            />
          }
        /> }      
      </div>
    );
  }
}

export default GeneExpression;
