import React from "react";
import { connect } from "react-redux";
import { AnchorButton, Tooltip, Position, Classes } from "@blueprintjs/core";
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
    volcanoAccessor: state.controls.volcanoAccessor
  };
})
class GeneSet extends React.Component {

  constructor(props) {
    super(props);
    this.state = {
      isOpen: false,
      genePage: 0,
      maxGenePage: Math.ceil((props.setGenes.length-0.1) / 10) - 1,
      removeHistZeros: false,
      queryGene: "",
      sortDirection: null,
      geneMetadatas: null,
      isSelected: false
    };
  }

  updateGeneMetadatas = () => {
    const { dispatch, varMetadata, setGenes } = this.props;
    const { sortDirection } = this.state;
    if (varMetadata !== ""){
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
    const dsu = (arr1, arr2) => arr1
    .map((item, index) => [arr2[index], item]) 
    .sort(([arg1], [arg2]) => arg2 - arg1) 
    .map(([, item]) => item); 

    const { setGenes } = this.props;
    const { geneMetadatas, sortDirection } = this.state;
    
    
    let setGenesSorted = setGenes;
    let geneMetadatasSorted = geneMetadatas;    
    
    const isString = typeof geneMetadatas[0] === "string";
    if (!isString) {
      setGenesSorted = dsu(setGenes, geneMetadatas);
      geneMetadatasSorted = geneMetadatas.slice().sort(function(a, b) {
        return Number(a) - Number(b);
      }).reverse();  
    } else {
      const map = Object.fromEntries(geneMetadatas.map((k, i) => [k, setGenes[i]]));
      geneMetadatasSorted = geneMetadatas.slice().sort().reverse();  
      setGenesSorted = [];
      geneMetadatasSorted.forEach((item)=>{
        setGenesSorted.push(map[item]);
      })
    }

    this.setState({
      ...this.state,
      setGenesSorted: setGenesSorted,
      geneMetadatasSorted: geneMetadatasSorted,
      sortDirection: sortD ? "descending" : sortDirection
    })   
  }  

  onSortGenesAscending = (sortD=false) => {
    const dsu = (arr1, arr2) => arr1
    .map((item, index) => [arr2[index], item]) 
    .sort(([arg1], [arg2]) => arg2 - arg1) 
    .map(([, item]) => item); 

    const { setGenes } = this.props;
    const { geneMetadatas, sortDirection } = this.state;
    let setGenesSorted = setGenes;
    let geneMetadatasSorted = geneMetadatas;    

    const isString = typeof geneMetadatas[0] === "string";
    if (!isString) {
      setGenesSorted = dsu(setGenes, geneMetadatas).reverse();
      geneMetadatasSorted = geneMetadatas.slice(function(a, b) {
        return Number(a) - Number(b);
      }).sort();  
    } else {
      const map = Object.fromEntries(geneMetadatas.map((k, i) => [k, setGenes[i]]));
      geneMetadatasSorted = geneMetadatas.slice().sort();  
      setGenesSorted = [];
      geneMetadatasSorted.forEach((item)=>{
        setGenesSorted.push(map[item]);
      })
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
  toggleAllOff = () => {
    const { dispatch, setGenes } = this.props;
    dispatch({type: "unselect genes", genes: setGenes})
    this.setState({
      ...this.state,
      isSelected: false
    })     
  }
  toggleAllOn = () => {
    const { dispatch, setGenes } = this.props;
    dispatch({type: "select genes", genes: setGenes})   
    this.setState({
      ...this.state,
      isSelected: true
    }) 
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
        />
      );
    });
  }

  render() {
    const { dispatch, setName, setGenes, genesetDescription, displayLabel, varMetadata, allGenes, userLoggedIn, currentSelectionDEG, volcanoAccessor } = this.props;
    const diffExp = genesetDescription?.includes("//;;//")

    const activeSelection = currentSelectionDEG === `${genesetDescription?.split('//;;//').at(0)}::${setName}`;    

    const { isOpen, maxGenePage, genePage, removeHistZeros, queryGene, sortDirection, isSelected } = this.state;
    const genesetNameLengthVisible = 150; /* this magic number determines how much of a long geneset name we see */
    const genesetIsEmpty = setGenes.length === 0;
    let sortIcon = "expand-all";
    
    if (sortDirection === "ascending"){
      sortIcon="chevron-up"
    } else if (sortDirection === "descending"){
      sortIcon="chevron-down"
    }
    
    return (
      <div style={{ marginBottom: 3}}>
        <div style={{display: "flex"}}>
          {userLoggedIn && 
            <div style={{paddingTop: "3px", paddingRight: "10px", backgroundColor: "#E0E0E0"}}>
              <input
                id={`${setName}-checkbox-selection`}
                className={`${Classes.CONTROL} ${Classes.CHECKBOX}`}

                onChange={isSelected ? this.toggleAllOff : this.toggleAllOn}
                data-testclass="geneset-select"
                data-testid={`geneset-select-${setName}`}
                checked={isSelected}
                type="checkbox"
              />
           </div>}   
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            backgroundColor: "#E0E0E0",
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
              cursor: "pointer",
              userSelect: "none",
            }}
            onClick={this.onGenesetMenuClick}
          >
            <Truncate
              tooltipAddendum={
                genesetDescription ? `: ${genesetDescription}` : ""
              }
            >
              <span
                style={{
                  maxWidth: globals.leftSidebarWidth - genesetNameLengthVisible,
                }}
                data-testid={`${setName}:geneset-label`}
              >
                {displayLabel}
              </span>
            </Truncate>
            {isOpen ? (
              <FaChevronDown
                data-testclass="geneset-expand-is-expanded"
                style={{ fontSize: 10, marginLeft: 5 }}
              />
            ) : (
              <FaChevronRight
                data-testclass="geneset-expand-is-not-expanded"
                style={{ fontSize: 10, marginLeft: 5 }}
              />
            )}
          </span>
          <div style={{display: "flex", textAlign: "right"}}>
          {diffExp && <Tooltip
          content={
            "Click to display volcano plot."
          }
          position={Position.RIGHT}
          hoverOpenDelay={globals.tooltipHoverOpenDelay}
          modifiers={{
            preventOverflow: { enabled: false },
            hide: { enabled: false },
          }}          
        >
        <AnchorButton
          onClick={() => {
            if (`${genesetDescription};;${setName}`===volcanoAccessor) {
              dispatch({type: "clear volcano plot"})
            } else {
              dispatch({type: "set volcano accessor",data: `${genesetDescription};;${setName}`})
            }
            
          }}
          minimal
          active={`${genesetDescription};;${setName}`===volcanoAccessor}
          icon={"scatter-plot"}
        />
        </Tooltip>}            
          {diffExp && <Tooltip
          content={
            "Click to select the cells associated with this DEG group."
          }
          position={Position.RIGHT}
          hoverOpenDelay={globals.tooltipHoverOpenDelay}
          modifiers={{
            preventOverflow: { enabled: false },
            hide: { enabled: false },
          }}          
        >
        <AnchorButton
          onClick={(e) => {this.selectCellsFromGroup()}}
          minimal
          active={activeSelection}
          icon={"polygon-filter"}
        />
        </Tooltip>}              
          <Tooltip
            content={
              "Click to sort genes by the chosen var metadata."
            }
            position={Position.RIGHT}
            hoverOpenDelay={globals.tooltipHoverOpenDelay}
            modifiers={{
              preventOverflow: { enabled: false },
              hide: { enabled: false },
            }}          
          >
          <AnchorButton
            onClick={(e) => {this.onSortGenes()}}
            active={sortDirection}
            minimal
            disabled={varMetadata === "" || !isOpen}
            icon={sortIcon}
          />
          </Tooltip>          
          {allGenes ? <div>
            <AnchorButton
              minimal
              icon={"vertical-bar-chart-desc"}
              onClick={() => {this.setState({...this.state,removeHistZeros: !removeHistZeros})}}
              active={removeHistZeros}
            /> 
          </div> : <div>
            <GenesetMenus 
              isOpen={isOpen}
              genesetsEditable 
              geneset={setName} 
              disableToggle={false} 
              histToggler={()=>{
                this.setState({...this.state,removeHistZeros: !removeHistZeros})
                }
              } 
              toggleText={removeHistZeros ? "Include zeros in histograms." : "Exclude zeros in histograms."}
              removeHistZeros={removeHistZeros}
              group={genesetDescription}
              />
          </div>}
          </div>
        </div>
        </div>

        <div style={{ marginLeft: 15, marginTop: 5, marginRight: 0 }}>
          {isOpen && genesetIsEmpty && (
            <p style={{ fontStyle: "italic", color: "lightgrey" }}>
              No genes to display
            </p>
          )}
        </div>
        {isOpen && !allGenes && !genesetIsEmpty && setGenes.length > 0 && (
          <HistogramBrush
            isGeneSetSummary
            field={setName}
            setGenes={setGenes}
            removeHistZeros={removeHistZeros}
          />
        )}
        {isOpen &&!genesetIsEmpty ? 
        <div>
        <div style={{
          textAlign: "right"
        }}>
          {`Showing genes ${genePage*10+1}-${Math.min((genePage+1)*10,setGenes.length)} / ${setGenes.length}`}
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
        <hr/>
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
          <hr/>
          </div>                               
         : null}
         
        {isOpen && !genesetIsEmpty && this.renderGenes()}
        <EditGenesetNameDialogue
          parentGeneset={setName}
          parentGenesetDescription={genesetDescription}
        />
      </div>
    );
  }
}

export default GeneSet;
