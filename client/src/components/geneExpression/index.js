import React from "react";
import { connect } from "react-redux";
import { AnchorButton, Tooltip, Position, MenuItem, Dialog } from "@blueprintjs/core";
import { Select } from "@blueprintjs/select";
import ParameterInput from "../menubar/parameterinput";
import GeneSet from "./geneSet";
import { GenesetHotkeys } from "../hotkeys";
import actions from "../../actions";
import * as globals from "../../globals";
import QuickGene from "./quickGene";
import styles from "./gene.css"

const Chevron = ({onClick, isOpen, text}) => {
  return (
      <div className={styles.unselectable}
      style={{
        display: "flex",
        cursor: "pointer",
        margin: "0 auto",
        flexDirection: "row",
      }}
      onClick={onClick}>
        <b style={{fontSize: 16, color: isOpen ? "black" : "gray"}}>{text}</b>
      </div>
  );
}

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
    currentlyDragged: state.controls.currentlyDragged
  };
})
class GeneExpression extends React.Component {
  constructor(props){
    super(props);
    this.counterPadder = 0;
    this.state={
      geneSetsExpanded: true,
      isEditingSetName: false,
      newNameText: "",
      nameBeingEdited: "",
      varMetadata: "",
      unsetShown: true,
      nogroupShown: true,
      diffShown: true,
      genesetShown: true,
      quickShown: true
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
    const els = [];
    const els2 = [];
    const unsets = [];

    const groupnames = Object.keys(genesets);
    groupnames.sort();
    for (const group of groupnames) {
      if (group !== "") {
        if (Object.keys(genesets[group]).length===0) {
          unsets.push(
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
          );
        } else {
          const setnames = Object.keys(genesets[group]);
          setnames.sort();
          const sets = [];
          for (const name of setnames) {
            sets.push(
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
          }
          if (group.includes("//;;//")) {
            els2.push(
              <GeneSet
                key={group}
                setName={group}
                genesetDescription={group}
                set={sets}
                rightWidth={rightWidth}
                setMode="genesets"
                noPaddedDropzones
                deleteGroup={() => {
                  dispatch(actions.genesetDeleteGroup(group))
                  dispatch(actions.requestDiffDelete(group))
                }}
              />
            ); 
          } else {
            els.push(
              <GeneSet
                key={group}
                setName={group}
                genesetDescription={group}
                set={sets}
                rightWidth={rightWidth}
                setMode="genesets"
                deleteGroup={() => {
                  dispatch(actions.genesetDeleteGroup(group))
                }}
              />
            );
          }         
        }
      } else {
        const nogroupnames = Object.keys(genesets[""]);
        nogroupnames.sort();
        for (const name of nogroupnames) {
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
    }
    return [unsets, nogroups, els, els2];      
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


  onDrop = (e) => {
    const { dispatch, genesets } = this.props;

    const el = document.getElementById("ungrouped-genesets-wrapper")
    el.style.boxShadow="none";
    
    this.counterPadder = 0;
    dispatch({type: "clear gene selection"})
    dispatch({type: "currently dragging", dragged: null})  

    const name = e.dataTransfer.getData("text");   
    const setgroup = name.split("@@").at(0)
    const setname = name.split("@@").at(1)  
    const quickGenesDragging = setgroup === "" && setname === "Gene search results";

    dispatch({
      type: "geneset: update",
      genesetDescription: setgroup,
      genesetName: setname,
      update: {
        genesetName: setname,
        genesetDescription: "",
      },
      isDragging: true
    });
    this.setState({nogroupShown: true})
    if (!name.includes("//;;//")) {
      dispatch(actions.genesetDelete(setgroup, setname));
    }                           
    dispatch({type: "track set", group: "", set: setname})   
    e.stopPropagation();      
    if (Object.keys(genesets[setgroup]).length === 1 && !name.includes("//;;//") && !quickGenesDragging) {
      dispatch(actions.genesetDeleteGroup(setgroup))
    }   
  }
  render() {
    const { dispatch, genesets, annoMatrix, userLoggedIn, var_keys, rightWidth, currentlyDragged } = this.props;
    const { varMetadata, preferencesDialogOpen, diffShown, nogroupShown, genesetShown, unsetShown } = this.state;
    const [unsetElements,nogroupElements,genesetElements,diffExpElements]=this.renderGeneSets();
    
    
    const setgroup = currentlyDragged?.split("@@")?.at(0)
    const setname = currentlyDragged?.split("@@")?.at(1)
    const genesetDragging = !currentlyDragged?.includes("@@@");
    

    const enableParentDrop = (
      !currentlyDragged ||
      currentlyDragged && (setgroup !== "") && genesetDragging && !Object.keys(genesets[""]).includes(setname)
    );        
    return (
      <div>
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
        <QuickGene rightWidth={rightWidth} onAddGene={()=>this.setState({quickShown: true})} openPreferences={()=>{this.setState({preferencesDialogOpen: true})}}/>
        </div>                 
        {userLoggedIn && 
        <div>
            <div style={{paddingBottom: 1}} onDragEnter={(e)=>{
              const el = document.getElementById("ungrouped-genesets-wrapper")
              el.style.boxShadow="none"        
              e.stopPropagation();
              e.preventDefault();
            }}>
            {("" in genesets) && 
                  <GeneSet
                    key={"Gene search results"}
                    setGenes={genesets[""]["Gene search results"]}
                    displayLabel={"Gene search results"}
                    setName={"Gene search results"}
                    genesetDescription={""}
                    rightWidth={rightWidth}
                    setMode="genes"
                  />}
            </div>
            <div id="ungrouped-genesets-wrapper"
              onDragOver={enableParentDrop ? (e)=>{
                const el = document.getElementById("ungrouped-genesets-wrapper")
                if (enableParentDrop)
                  el.style.boxShadow= "inset 0px 0px 0px 2px #000";
                e.stopPropagation();
                e.preventDefault();
              } : null}
              onDrop={enableParentDrop ? this.onDrop : null}>
              {this.renderGeneSets(true)}                
              {nogroupShown && nogroupElements}                     
            </div>    
            {unsetShown && unsetElements}
            {genesetShown && genesetElements}

            <div className={styles.unselectable} style={{paddingBottom: "5px",paddingTop: "5px", cursor: "default"}}>
              <b>Differential expression</b>
              {diffShown && diffExpElements}              
            </div>

            

        </div>}          
      </div>
    );
  }
}

export default GeneExpression;
