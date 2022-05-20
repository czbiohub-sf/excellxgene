import React from "react";
import { connect } from "react-redux";
import { AnchorButton, Tooltip, Position, MenuItem, Dialog } from "@blueprintjs/core";
import { Select } from "@blueprintjs/select";
import ParameterInput from "../menubar/parameterinput";
import GeneSet from "./geneSet";
import { GenesetHotkeys } from "../hotkeys";
import actions from "../../actions";
import * as globals from "../../globals";
import AnnoDialog from "../annoDialog";
import LabelInput from "../labelInput";
import QuickGene from "./quickGene";

@connect((state) => {
  let var_keys = state.annoMatrix?.schema?.annotations?.varByName ?? {};
  var_keys = Object.keys(var_keys);
  const vk = [];
  var_keys.forEach((item)=>{
    if (item !== "name_0"){
      vk.push(item.split(';;').at(0))
    }   
  })  
  return {
    var_keys: [... new Set(vk)],
    allGenes: state.controls.allGenes.__columns[0],
    colorAccessor: state.colors.colorAccessor,
    genesets: state.genesets.genesets,
    annoMatrix: state.annoMatrix,
    reembedParams: state.reembedParameters,
    userLoggedIn: state.controls.userInfo ? true : false,
    cxgMode: state.controls.cxgMode,
  };
})
class GeneExpression extends React.Component {
  constructor(props){
    super(props);
    this.state={
      geneSetsExpanded: true,
      isEditingSetName: false,
      newNameText: "",
      nameBeingEdited: "",
      varMetadata: "",
    };
  }

  handleChangeOrSelect = (name) => {
    const { nameBeingEdited } = this.state;
    const suffix = nameBeingEdited.includes('//;;//') ? '//;;//' : ''
    this.setState({
      newNameText: `${name}${suffix}`,
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
      dispatch({type: "geneset: update",genesetDescription: oldName, update: {genesetDescription: newName}})
    }
    if (oldName.includes("//;;//")){
      dispatch(actions.requestDiffRename(oldName.split('//;;//').at(0),newName.split('//;;//').at(0)))    
    }
    dispatch(actions.requestSetRename(oldName,newName)) 
    dispatch({type: "track set", group: newName, set: null})   
    this.disableEditNameMode()
  }

  renderGeneSets = (isGenes=false) => {
    if (isGenes) {
      const { allGenes, rightWidth, cxgMode } = this.props;
      const name = cxgMode==="OBS" ? `All genes` : `All cells`
      return (
        <GeneSet
          key={name}
          setGenes={allGenes}
          displayLabel={name}
          setName={name}
          allGenes
          rightWidth={rightWidth}
          setMode="genes"
          genesetDescription={""}
        />
      );  
    }
    
    const { dispatch, genesets, rightWidth } = this.props;    
    const nogroups = [];
    if ("" in genesets) {
      for (const name in genesets[""]) {
        if (name !== "Gene search results"){
          nogroups.push(
            <GeneSet
              key={name}
              setGenes={genesets[""][name]}
              displayLabel={name}
              setName={name}
              genesetDescription={""}
              rightWidth={rightWidth}
              setMode="genes"
            />
          );   
        }     
      }
    }
    const sets = {};
    const sets2 = {};
    const groupnames = Object.keys(genesets);
    groupnames.sort();
    for (const group of groupnames) {
      if (group !== "") {
        if (Object.keys(genesets[group]).length===0) {
          sets[group] = (
            <GeneSet
              key={group}
              setName={group}
              genesetDescription={group}
              rightWidth={rightWidth}
              setMode="unset"
              deleteGroup={() => {
                dispatch(actions.genesetDeleteGroup(group))
              }}
            />
          )
        } else {
          for (const name in genesets[group]) {
            const set = (
              <GeneSet
                key={name}
                setGenes={genesets[group][name]}
                displayLabel={name}
                setName={name}
                genesetDescription={group}
                rightWidth={rightWidth}
                setMode="genes"
              />
            );
  
            if (!group.includes("//;;//")){
              if ( group in sets ){
                sets[group].push(set)
              } else {
                sets[group] = [set]
              } 
            } else {
              if ( group in sets2 ){
                sets2[group].push(set)
              } else {
                sets2[group] = [set]
              }             
            }
          }
          if (group.includes("//;;//")) {
            sets2[group] = (
              <GeneSet
                key={group}
                setName={group}
                genesetDescription={group}
                set={sets2[group]}
                rightWidth={rightWidth}
                setMode="genesets"
                deleteGroup={() => {
                  dispatch(actions.genesetDeleteGroup(group))
                  dispatch(actions.requestDiffDelete(group))
                }}
              />
            ); 
          } else {
            sets[group] = (
              <GeneSet
                key={group}
                setName={group}
                genesetDescription={group}
                set={sets[group]}
                rightWidth={rightWidth}
                setMode="genesets"
                deleteGroup={() => {
                  dispatch(actions.genesetDeleteGroup(group))
                }}
              />
            );
          }         
        }
      }
    }

    const els = [];
    for ( const key in sets ){
      els.push(
        sets[key]        
      )
    }

    const els2 = [];
    for ( const key in sets2 ){
      els2.push(
        sets2[key]
      )
    }
    return [nogroups, els, els2];      
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


  handleActivateCreateGenesetMode = () => {
    const { dispatch } = this.props;
    dispatch({ type: "geneset: activate add new geneset mode" });
  };

  render() {
    const { dispatch, genesets, annoMatrix, userLoggedIn, var_keys, cxgMode, rightWidth } = this.props;
    const { isEditingSetName, newNameText, nameBeingEdited, varMetadata, preferencesDialogOpen } = this.state;
    const [nogroupElements,genesetElements,diffExpElements]=this.renderGeneSets();
    const cOrG = cxgMode === "OBS" ? "gene" : "cell";
    

    return (
      <div
      >
       {userLoggedIn ?  <GenesetHotkeys
          dispatch={dispatch}
          genesets={genesets}
        /> : null}

        <div style={{
              display: "flex",
              justifyContent: "left",
              columnGap: "5px"}}>    
         
        <Dialog
          title="Preferences"
          isOpen={preferencesDialogOpen}
          onClose={()=>{this.setState({preferencesDialogOpen: false})}}
        >
          <div style={{
            margin: "0 auto",
            paddingTop: "10px",
            width: "90%"
          }}>
            <div style={{
              marginBottom: "20px",
              display: "flex",
              justifyContent: "left",
              columnGap: "10px"
            }}>   
            {/*<span style={{margin: "auto 0", paddingRight: "10px"}}>
            <b>{"Expression options:"}</b>
            </span>*/}    
            <ParameterInput
              label="Scale genes"
              param="scaleExpr"
              tooltipContent={"Check to standardize gene expression across cells."}
              left
            />               
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
            {var_keys.length > 0 && <Tooltip
                content={"The gene metadata to display."}
                position={Position.RIGHT}
                hoverOpenDelay={globals.tooltipHoverOpenDelay}
                modifiers={{
                  preventOverflow: { enabled: false },
                  hide: { enabled: false },
                }}
              >   
                <Select
                items={
                  var_keys
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
                  this.setState({
                    ...this.state,
                    varMetadata: d
                  })
                  dispatch({type: "set var key", key: d})                  
                }}
              >
                <AnchorButton
                  text={`Gene metadata to display: ${varMetadata}`}
                  rightIcon="double-caret-vertical"
                />
              </Select>
            </Tooltip>}            
          </div>
        </Dialog>           
        <QuickGene rightWidth={rightWidth} openPreferences={()=>{this.setState({preferencesDialogOpen: true})}}/>  
        </div>                 
        {userLoggedIn && <div>
          <div style={{ display: "flex", flexDirection: "row", justifyContent: "right" }}>      
            <div style={{
              marginBottom: 10, position: "relative", top: -2
            }}>           
            {/*<Button
              data-testid="open-create-geneset-dialog"
              onClick={this.handleActivateCreateGenesetMode}
              intent="primary"
              disabled={!userLoggedIn}
            >
              Create new
            </Button>*/}
            </div>    
          </div>
          {/*<CreateGenesetDialogue />*/}

          
          <div>
            <div style={{marginBottom: 10}}>    
            {("" in genesets) && <GeneSet
                key={"Gene search results"}
                setGenes={genesets[""]["Gene search results"]}
                displayLabel={"Gene search results"}
                setName={"Gene search results"}
                genesetDescription={""}
                rightWidth={rightWidth}
                setMode="genes"
            />}
            </div>
            {this.renderGeneSets(true)}
            {nogroupElements}                     
            {genesetElements}
            {(diffExpElements.length > 0) && <div style={{paddingBottom: "5px",paddingTop: "5px"}}>
              <b>Differential expression {cOrG} sets</b>
            </div> }                         
            {diffExpElements}              
            </div>
            

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
          title={`Edit ${cOrG} set group name`}
          instruction={`Choose a new ${cOrG} set group name`}
          cancelTooltipContent="Close this dialog without editing the name."
          primaryButtonText={`Edit ${cOrG} set group name`}
          text={newNameText}
          handleSubmit={this.handleEditName}
          handleCancel={this.disableEditNameMode}
          validationError={newNameText===nameBeingEdited}
          allowEmpty
          annoInput={
            <LabelInput
              label={newNameText.split('//;;//').at(0)}
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
        {/*<div style={{
          paddingTop: '50px',
          paddingBottom: '20px'
        }}>
          {this.renderGeneSets(true)}
        </div>*/}               
      </div>
    );
  }
}

export default GeneExpression;
