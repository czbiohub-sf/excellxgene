import React from "react";
import { connect } from "react-redux";
import { AnchorButton, Tooltip, Icon } from "@blueprintjs/core";
import LabelInput from "../labelInput";
import { FaChevronRight, FaChevronDown } from "react-icons/fa";
import actions from "../../actions";
import Gene from "./gene";
import Truncate from "../util/truncate";
import * as globals from "../../globals";
import GenesetMenus from "./menus/genesetMenus";
import EditGenesetNameDialogue from "./menus/editGenesetNameDialogue";
import HistogramBrush from "../brushableHistogram";
import { resetSubsetAction } from "../../actions/viewStack";
import styles from "./gene.css"

@connect((state) => {
  return {
    world: state.world,
    varMetadata: state.controls.varMetadata,
    userDefinedGenes: state.controls.userDefinedGenes,
    userDefinedGenesLoading: state.controls.userDefinedGenesLoading,
    userLoggedIn: state.controls.userInfo ? true : false,
    layoutChoice: state.layoutChoice,
    varRefresher: state.controls.varRefresher,
    currentSelectionDEG: state.controls.currentSelectionDEG,
    volcanoAccessor: state.controls.volcanoAccessor,
    cxgMode: state.controls.cxgMode,
    geneSelection: state.geneSelection.genes
  };
})
class GeneSet extends React.Component {

  constructor(props) {
    super(props);
    const { setGenes, setName } = props;
    this.state = {
      isOpen: false || setName === "Gene search results",
      genePage: 0,
      maxGenePage: setGenes ? Math.ceil((setGenes.length-0.1) / 10) - 1 : null,
      removeHistZeros: false,
      queryGene: "",
      sortDirection: null,
      geneMetadatas: null,
      isGensetFolderOpen: false,
      isHovered: false,
      setMode: props.setMode,
      trashShown: false,
      contentEditable: false,
      mouseLeft: false
    };
  }

  updateGeneMetadatas = () => {
    const { dispatch, varMetadata, setGenes } = this.props;
    const { sortDirection } = this.state;
    if (varMetadata !== "" && setGenes && setGenes?.length > 0){
      dispatch(actions.fetchGeneInfoBulk(setGenes, varMetadata)).then((res)=>{
        this.setState({
          ...this.state,
          geneMetadatas: res
        })
        if (sortDirection === "descending") { 
          this.onSortGenesDescending();
        } else if (sortDirection === "ascending") {
          this.onSortGenesAscending();  
        } else { 
          this.onSortGenesReset(); 
        } 
      })
    }
  }
  componentDidMount() {
    const { varMetadata } = this.props;
    if (varMetadata !== "") {
      this.updateGeneMetadatas()
    }
  }
  componentDidUpdate = (prevProps) => {
    const { setGenes, varMetadata, layoutChoice, varRefresher } = this.props;
    const { setGenes: setGenesPrev, varMetadata: varMetadataPrev } = prevProps;
    if (setGenes !== setGenesPrev) {
      this.setState({
        ...this.state,
        maxGenePage: Math.ceil((setGenes.length-0.1) / 10) - 1,
      })
      this.updateGeneMetadatas();
    } else if (varMetadata !== varMetadataPrev ||
               layoutChoice.current !== prevProps.layoutChoice.current ||
               varRefresher !== prevProps.varRefresher) {
      this.updateGeneMetadatas();
    }
    
  }
  onQueryGeneChange = (e) => {
    this.setState({...this.state, queryGene: e})
  }  
  onQueryGeneSelect = (e) => {
    const { dispatch, setGenes } = this.props;    
    const newGenePage = Math.floor(setGenes.indexOf(e) / 10)
    this.setState({...this.state, queryGene: e, genePage: newGenePage})
    dispatch(actions.requestSingleGeneExpressionCountsForColoringPOST(e));
  }  
  decrementGenePage = () => { 
    const { genePage } = this.state;
    this.setState({
      genePage: genePage-1
    })
  }
  incrementGenePage = () => { 
    const { genePage } = this.state;
    this.setState({
      genePage: genePage+1
    })
  }  
  onGenesetMenuClick = () => {
    const { isOpen } = this.state;
    if (isOpen) {
      this.onSortGenes(true);
    }
    this.setState({ isOpen: !isOpen });
  };
  onGenesetFolderClick = (e) => {
    const { isGensetFolderOpen } = this.state;
    this.setState({ isGensetFolderOpen: !isGensetFolderOpen });
  };  
  onSortGenesReset = (sortD=false) => {
    const { setGenes } = this.props;
    const { geneMetadatas, sortDirection } = this.state;
    let setGenesSorted = setGenes;
    let geneMetadatasSorted = geneMetadatas;    

    this.setState({
      ...this.state,
      setGenesSorted: setGenesSorted,
      geneMetadatasSorted: geneMetadatasSorted,
      sortDirection: sortD ? null : sortDirection    
    })
  }

  onSortGenesDescending = (sortD=false) => {
    const { setGenes } = this.props;
    const { geneMetadatas, sortDirection } = this.state;
    
    
    let setGenesSorted = setGenes;
    let geneMetadatasSorted = geneMetadatas;    
    
    const isString = typeof geneMetadatas[0] === "string";
    if (!isString) {
      const dsu = (arr1, arr2) => arr1
      .map((item, index) => [arr2[index], item]) 
      .sort(([arg1], [arg2]) => arg2 - arg1) 
      .map(([, item]) => item); 

      setGenesSorted = dsu(setGenes, geneMetadatas);
      geneMetadatasSorted = geneMetadatas.slice().sort(function(a, b) {
        return Number(a) - Number(b);
      }).reverse();  
    } else {
      const dsu = (arr1, arr2) => arr1
      .map((item, index) => [arr2[index], item]) 
      .sort(([arg1], [arg2]) => arg2.charCodeAt(0) - arg1.charCodeAt(0)) 
      .map(([, item]) => item); 
            
      setGenesSorted = dsu(setGenes, geneMetadatas);
      geneMetadatasSorted = geneMetadatas.slice().sort(function(a, b) {
        return a.charCodeAt(0) - b.charCodeAt(0);
      }).reverse();  
    }

    this.setState({
      ...this.state,
      setGenesSorted: setGenesSorted,
      geneMetadatasSorted: geneMetadatasSorted,
      sortDirection: sortD ? "descending" : sortDirection
    })   
  }  

  onSortGenesAscending = (sortD=false) => {
    const { setGenes } = this.props;
    const { geneMetadatas, sortDirection } = this.state;
    let setGenesSorted = setGenes;
    let geneMetadatasSorted = geneMetadatas;    

    const isString = typeof geneMetadatas[0] === "string";
    if (!isString) {
      const dsu = (arr1, arr2) => arr1
      .map((item, index) => [arr2[index], item]) 
      .sort(([arg1], [arg2]) => arg2 - arg1) 
      .map(([, item]) => item); 

      setGenesSorted = dsu(setGenes, geneMetadatas).reverse();
      geneMetadatasSorted = geneMetadatas.slice(function(a, b) {
        return Number(a) - Number(b);
      }).sort();  
    } else {
      const dsu = (arr1, arr2) => arr1
      .map((item, index) => [arr2[index], item]) 
      .sort(([arg1], [arg2]) => arg2.charCodeAt(0) - arg1.charCodeAt(0)) 
      .map(([, item]) => item); 
            
      setGenesSorted = dsu(setGenes, geneMetadatas).reverse();
      geneMetadatasSorted = geneMetadatas.slice(function(a, b) {
        return a.charCodeAt(0) - b.charCodeAt(0);
      }).sort();  
    }

    this.setState({
      ...this.state,
      setGenesSorted: setGenesSorted,
      geneMetadatasSorted: geneMetadatasSorted,
      sortDirection: sortD ? "ascending" : sortDirection
    })   
  }  

  onSortGenes = (reset=false) => {
    const { sortDirection } = this.state;
    if (reset) {
      this.onSortGenesReset(true)
    } else {
      if (sortDirection === "descending") { 
        this.onSortGenesAscending(true);
      } else if (sortDirection === "ascending") {
        this.onSortGenesReset(true);  
      } else { 
        this.onSortGenesDescending(true); 
      }      
    }
  }

  writeSort = () => {
    const { genesetDescription: group, setName: geneset, dispatch } = this.props;
    const { setGenesSorted } = this.state;
    dispatch(actions.genesetDeleteGenes(group, geneset, setGenesSorted));
    dispatch(actions.genesetAddGenes(group, geneset, setGenesSorted));   
    this.onSortGenesReset(true)
  }

  selectCellsFromGroup = () => {
    const { dispatch, genesetDescription, setName, currentSelectionDEG } = this.props;
    const name = `${genesetDescription?.split('//;;//').at(0)}::${setName}`

    const activeSelection = currentSelectionDEG === name;
    if (!activeSelection) {
      dispatch(actions.requestDiffExpPops(genesetDescription?.split('//;;//').at(0),setName)).then((x)=>{
        dispatch(actions.selectCellsFromArray(x.pop, name))
      })
    } else {
      dispatch(resetSubsetAction())    
    }

  }

  renderGenes() {
    const { setName, allGenes, genesetDescription, setGenes, setGenesWithDescriptions, rightWidth } = this.props;
    const { genePage, removeHistZeros, geneMetadatas, setGenesSorted, geneMetadatasSorted } = this.state;
    let genes = setGenes;
    let genesM = geneMetadatas;
    if (setGenesSorted && geneMetadatasSorted) {
      genes = setGenesSorted;
      genesM = geneMetadatasSorted;
    }
    return genes.slice(genePage*10,(genePage+1)*10).map((gene,i) => {
      let geneDescription;
      if (setGenesWithDescriptions) {
        const { geneDescription: x } = setGenesWithDescriptions.get(gene);
        geneDescription = x;
      } else {
        geneDescription = gene;
      }
      
      let geneInfo;
      if (genesM){
        geneInfo = genesM[genePage*10+i];
      } else {
        geneInfo = ""
      }
      return (
        <Gene
          key={gene}
          gene={gene}
          geneDescription={geneDescription}
          geneset={setName}
          removeHistZeros={removeHistZeros}
          geneInfo={geneInfo}
          rightWidth={rightWidth}
          group={genesetDescription}
          allGenes={allGenes}
          parentGenes={genes}
        />
      );
    });
  }

  render() {
    const { dispatch, setName, setGenes, genesetDescription, deleteGroup,
            displayLabel, varMetadata, allGenes, currentSelectionDEG, volcanoAccessor, cxgMode,
            set, geneSelection } = this.props;
    const diffExp = genesetDescription?.includes("//;;//")
    const cOrG = cxgMode === "OBS" ? "genes" : "cells";
    const activeSelection = currentSelectionDEG === `${genesetDescription?.split('//;;//').at(0)}::${setName}`;    

    const { isOpen, maxGenePage, mouseLeft, genePage, removeHistZeros, queryGene, sortDirection, isGensetFolderOpen, isHovered, setMode, trashShown, contentEditable } = this.state;
    const genesetNameLengthVisible = 150; /* this magic number determines how much of a long geneset name we see */
    const genesetIsEmpty = setGenes?.length === 0;
    let sortIcon = "expand-all";
    if (sortDirection === "ascending"){
      sortIcon="chevron-up"
    } else if (sortDirection === "descending"){
      sortIcon="chevron-down"
    }
    return (
      <div id={`${genesetDescription}@@${setName}-geneset`} draggable={setMode === "genes" && !allGenes} onDragStart={(e)=>{
        e.dataTransfer.setData("text",`${genesetDescription}@@${setName}`)
        e.stopPropagation();
      }} onDragOver={(e)=>{
        e.stopPropagation();
        e.preventDefault();
      }} onDrop={(e)=>{
        dispatch({type: "clear gene selection"})
        const name = e.dataTransfer.getData("text");   
        const setgroup = name.split("@@").at(0)
        const setname = name.split("@@").at(1)             
        if (name.includes("@@@") && setMode !== "genesets") { 
          const _gene = name.split("@@@").at(1);
          let genesToAdd = [...geneSelection];
          if (!geneSelection.has(_gene)) {
            genesToAdd = [_gene,...genesToAdd];
          }         
          if (setgroup === "" && setname === "Gene search results") {
            dispatch(actions.genesetDeleteGenes(setgroup, setname, genesToAdd));          
          }                  

          if (setMode === "unset") {
            dispatch({
              type: "geneset: update",
              genesetDescription,
              genesetName: null,
              update: {
                genesetName: setName,
                genesetDescription: "",
              },
            });
            dispatch(actions.genesetAddGenes("", setName, genesToAdd)); 
          } else {
            dispatch(actions.genesetAddGenes(genesetDescription, setName, genesToAdd));
          }
        } else if (!name.includes("@@@") && setMode !== "genes") {
          dispatch({
            type: "geneset: update",
            genesetDescription: setgroup,
            genesetName: setname,
            update: {
              genesetName: setname,
              genesetDescription: genesetDescription,
            },
            isDragging: true
          });
          dispatch({type: "track set", group: genesetDescription, set: setname})       
          e.stopPropagation();  
        }
      }}
      onKeyDown={(e)=>{
        if (e.metaKey && e.code === "KeyA" && isOpen) {
          if (setGenes && setGenes.length > 0){
            dispatch({type: "select genes", genes:  setGenes})
          }
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onMouseEnter={(e)=>{
        const el = document.getElementById(`${genesetDescription}@@${setName}-geneset`)
        el.tabIndex=-1;
        document.activeElement.blur();
        el.style.border = "none";
        el.style.outline = "none";
        el.focus();
        e.preventDefault();
        e.stopPropagation();        
      }}     
      >
        {setMode === "genes" ? 
        (<>
          {setName !== "Gene search results" && <div onMouseOver={()=>{
            this.setState({isHovered: true})
          }} onMouseLeave={()=>{
            this.setState({isHovered: false})
          }} style={{cursor: contentEditable || allGenes ? undefined : "move", display: "flex", paddingTop: 5, paddingBottom: 5}}>  
          <div
            style={{
              display: "flex",
              columnGap: 30,
              alignItems: "baseline",
              width: "100%"
            }}
          >       
          <span
            role="menuitem"
            tabIndex="0"
            data-testclass="geneset-expand"
            data-testid={`${setName}:geneset-expand`}
            onKeyPress={
              /* TODO(colinmegill): #2101: click handler on span */ () => {}
            }
            style={{
              display: "flex",
              userSelect: "none",
            }}
          >
            <div style={{cursor: "pointer"}} onClick={this.onGenesetMenuClick}>
            {isOpen ? (
              <FaChevronDown
                data-testclass="geneset-expand-is-expanded"
                style={{ fontSize: 10, marginRight: 5, marginLeft: genesetDescription !== "" ? globals.indentPaddingGeneset : 0 }}
              />
            ) : (
              <FaChevronRight
                data-testclass="geneset-expand-is-not-expanded"
                style={{ fontSize: 10, marginRight: 5, marginLeft: genesetDescription !== "" ? globals.indentPaddingGeneset : 0 }}
              />
            )}
            </div>

            <div
                onMouseOver={()=>{
                  if (!diffExp && !allGenes) {
                    const el = document.getElementById(`${displayLabel}-editable-set-span`)
                    el.style.outlineWidth = "2px";
                    el.style.outlineColor =  "rgba(19, 124, 189, 0.6)";
                    el.style.outlineStyle = "auto";
                    el.style.outlineOffset = "2px"; 
                    this.setState({mouseLeft: false})   
                  }                 
                }}                  
                onMouseLeave={()=>{
                  if (!diffExp && !allGenes) {
                    const el = document.getElementById(`${displayLabel}-editable-set-span`)                             
                    if (!contentEditable || document.activeElement.children[0] !== el) {
                      el.style.outline = "none";   
                      this.setState({contentEditable: false})
                    }
                    this.setState({mouseLeft: true})
                  }
                }}
                onClick={(e)=>{
                  if (!diffExp && !allGenes) {
                    this.setState({contentEditable: true})
                  }
                }}
                contentEditable={contentEditable}
                suppressContentEditableWarning
                onBlur={()=>{
                  if (!diffExp && !allGenes) {
                    const el = document.getElementById(`${displayLabel}-editable-set-span`)          
                    if (mouseLeft) {
                      el.style.outline = "none";                    
                    }
                    
                    this.setState({contentEditable: false})

                    const newName = `${el.textContent}`
                    dispatch({type: "geneset: update",
                              genesetDescription,
                              genesetName: setName,
                              update: {genesetDescription: genesetDescription, genesetName: newName}})
                    
                    let groupName;
                    if (genesetDescription === "") {
                      groupName = "__blank__";
                    } else {
                      groupName = genesetDescription;
                    }
                    dispatch(actions.requestGeneSetRename(groupName,groupName,setName,newName));
                  }
                }} // this callback, or "Enter" keypress will trigger the name change in reducers.   
                onKeyDown={(e)=>{
                  if (!diffExp && !allGenes) {
                    if (e.key === "Enter" || e.key === "Escape"){
                      e.target.blur();
                    }
                  }
                }}              
              style={{
                maxWidth: globals.leftSidebarWidth - genesetNameLengthVisible,
              }}
              data-testid={`${setName}:geneset-label`}
            >
              <span id={`${displayLabel}-editable-set-span`}>{displayLabel}</span>
            </div>
          </span>
          <div>
            <GenesetMenus 
              diffExp={diffExp}
              activeSelection={activeSelection}
              sortDirection={sortDirection}
              varMetadata={varMetadata}
              sortIcon={sortIcon}
              volcanoAccessor={volcanoAccessor}
              isOpen={isOpen}
              setMode={setMode}
              genesetsEditable 
              geneset={setName} 
              disableToggle={false} 
              writeSort={this.writeSort}
              isHovered={isHovered}
              disableWriteSort={!sortDirection}
              histToggler={()=>{
                this.setState({...this.state,removeHistZeros: !removeHistZeros})
                }
              } 
              onSortGenes={()=>this.onSortGenes()}
              selectCellsFromGroup={this.selectCellsFromGroup}
              volcanoClick={() => {
                if (`${genesetDescription};;${setName}`===volcanoAccessor) {
                  dispatch({type: "clear volcano plot"})
                } else {
                  dispatch({type: "set volcano accessor",data: `${genesetDescription};;${setName}`})
                }
                
              }}
              toggleText={removeHistZeros ? "Include zeros in histograms." : "Exclude zeros in histograms."}
              removeHistZeros={removeHistZeros}
              group={genesetDescription}
            />
          </div>
          </div>
          </div>}
          <div>
          {setName !== "Gene search results" && isOpen && !allGenes && !genesetIsEmpty && setGenes.length > 0 && (
            <HistogramBrush
              isGeneSetSummary
              field={setName}
              setGenes={setGenes}
              removeHistZeros={removeHistZeros}
            />
          )}
          {isOpen &&!genesetIsEmpty && setName !== "Gene search results" ? 
          <div style={{marginLeft: genesetDescription!=="" ? globals.indentPaddingGeneset : 0}}>
          <div className={styles.unselectable} style={{
            textAlign: "right"
          }}>
            {`Showing ${cOrG} ${genePage*10+1}-${Math.min((genePage+1)*10,setGenes.length)} / ${setGenes.length}`}
            <AnchorButton
              type="button"
              icon="double-chevron-left"
              onClick={()=>{this.setState({...this.state,genePage: 0})}}
              minimal
              disabled={genePage === 0}
            />          
            <AnchorButton
              type="button"
              icon="chevron-left"
              onClick={this.decrementGenePage}
              minimal
              disabled={genePage === 0}
            />
            <AnchorButton
              type="button"
              icon="chevron-right"
              onClick={this.incrementGenePage}
              minimal
              disabled={genePage === maxGenePage}
            />  
            <AnchorButton
              type="button"
              icon="double-chevron-right"
              onClick={()=>{this.setState({...this.state,genePage: maxGenePage})}}
              minimal
              disabled={genePage === maxGenePage}
            />                            
          </div>
            <div style={{
              display: "flex"
            }}>
      
            <LabelInput
              labelSuggestions={setGenes}
              onChange={this.onQueryGeneChange}
              onSelect={this.onQueryGeneSelect}
              label={queryGene}
              geneComplete
              popoverProps={null}
            />          
            </div>    
            </div>                               
          : null}
          
          {isOpen && !genesetIsEmpty && this.renderGenes()}
          <EditGenesetNameDialogue
            parentGeneset={setName}
            parentGenesetDescription={genesetDescription}
          />
        </div>
        </>) :           
        <div style={{paddingTop: 5, paddingBottom: 5}}>
          <div onMouseOver={()=>this.setState({trashShown: true})}
        onMouseLeave={()=>this.setState({trashShown: false})} style={{display: "flex", flexDirection: "row", columnGap: 30}}>
            <span
                role="menuitem"
                tabIndex="0"
                data-testclass="geneset-folder-expand"
                data-testid={`${genesetDescription}:geneset-folder-expand`}
                style={{
                  userSelect: "none",
                  display: "flex"
                }}
              >
                <div onClick={this.onGenesetFolderClick} style={{cursor: "pointer"}}>
                {isGensetFolderOpen ? (
                  <FaChevronDown
                    data-testclass="geneset-folder-expand-is-expanded"
                    style={{ fontSize: 10, marginRight: 5}}
                  />
                ) : (
                  <FaChevronRight
                    data-testclass="geneset-folder-expand-is-not-expanded"
                    style={{ fontSize: 10, marginRight: 5}}
                  />
                )}
                </div>
                <div
                  onMouseOver={()=>{
                    const el = document.getElementById(`${setName}-editable-span`)
                    el.style.outlineWidth = "2px";
                    el.style.outlineColor =  "rgba(19, 124, 189, 0.6)";
                    el.style.outlineStyle = "auto";
                    el.style.outlineOffset = "2px"; 
                    this.setState({mouseLeft: false})                    
                  }}                  
                  onMouseLeave={()=>{
                    const el = document.getElementById(`${setName}-editable-span`)                               
                    if (!contentEditable || document.activeElement.children[0] !== el) {
                      el.style.outline = "none";   
                      this.setState({contentEditable: false})
                    }
                    this.setState({mouseLeft: true})
                  }}
                  onClick={(e)=>{
                    this.setState({contentEditable: true})
                  }}
                  contentEditable={contentEditable}
                  suppressContentEditableWarning
                  onBlur={()=>{
                    const el = document.getElementById(`${setName}-editable-span`)            
                    if (mouseLeft) {
                      el.style.outline = "none";                    
                    }
                    
                    this.setState({contentEditable: false})
                    const x = diffExp ? "//;;//" : "";
                    const newName = `${el.textContent}${x}`
                    dispatch({type: "geneset: update",genesetDescription, update: {genesetDescription: newName}})
                    if (diffExp) {
                      dispatch(actions.requestDiffRename(genesetDescription.split('//;;//').at(0),newName.split('//;;//').at(0)))    
                    }
                    dispatch(actions.requestSetRename(genesetDescription,newName))
                    dispatch({type: "track set", group: newName, set: null})   
                
                  }} // this callback, or "Enter" keypress will trigger the name change in reducers.   
                  onKeyDown={(e)=>{
                    if (e.key === "Enter" || e.key === "Escape"){
                      e.target.blur();
                      //this.setState({contentEditable: false})
                    }
                  }}               
                  style={{
                    maxWidth: globals.leftSidebarWidth - genesetNameLengthVisible
                  }}
                >
                  <span id={`${setName}-editable-span`}>{setName ? setName.split('//;;//').at(0) : ""}</span>
                </div>
            </span> 
            {trashShown && <div style={{marginTop: -2}}>
                <Tooltip
                  content={`Delete group`}
                  position="top"
                  hoverOpenDelay={globals.tooltipHoverOpenDelay}            
                  >
                  <AnchorButton
                    icon={<Icon icon="trash" iconSize={10} />}
                    minimal
                    intent="danger"
                    style={{
                      cursor: "pointer",
                      minHeight: 0,
                      minWidth: 0,
                      padding: 0
                    }}
                    onClick={deleteGroup}
                  />    
                  </Tooltip> 
                </div>}
            </div>            

            {isGensetFolderOpen && set}
          </div>
          } {/* wrap set with geneset folder*/}
      </div>
    );
  }
}

export default GeneSet;
