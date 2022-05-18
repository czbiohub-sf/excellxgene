import React from "react";
import { connect } from "react-redux";
import { Button, Icon } from "@blueprintjs/core";
import Truncate from "../util/truncate";
import HistogramBrush from "../brushableHistogram";
import * as globals from "../../globals";
import actions from "../../actions";
import styles from "./gene.css"
const MINI_HISTOGRAM_WIDTH = 110;

@connect((state, ownProps) => {
  const { gene } = ownProps;

  return {
    varMetadata: state.controls.varMetadata,
    isSelected: state.geneSelection.genes.has(gene),
    isColorAccessor: state.colors.colorAccessor === gene,
    isScatterplotXXaccessor: state.controls.scatterplotXXaccessor === gene,
    isScatterplotYYaccessor: state.controls.scatterplotYYaccessor === gene,
    dataLayerExpr: state.reembedParameters.dataLayerExpr,
    logScaleExpr: state.reembedParameters.logScaleExpr,
    scaleExpr: state.reembedParameters.scaleExpr,
    userLoggedIn: state.controls.userInfo ? true : false,
    multiGeneSelect: state.controls.multiGeneSelect,
    lastClickedGene: state.controls.lastClickedGene
  };
})
class Gene extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      geneIsExpanded: false,
      isHovered: false
    };
  }

  onColorChangeClick = (e) => {
    const { dispatch, gene, isObs } = this.props;
    if (isObs) {
      dispatch({
        type: "color by continuous metadata",
        colorAccessor: gene,
      });      
    } else {
      dispatch(actions.requestSingleGeneExpressionCountsForColoringPOST(gene));
    }
    e.stopPropagation();
  };
  handleGeneExpandClick = (e) => {
    const { geneIsExpanded } = this.state;
    this.setState({ geneIsExpanded: !geneIsExpanded });
    e.stopPropagation();
  };

  handleSetGeneAsScatterplotX = (e) => {
    const { dispatch, gene, isObs } = this.props;
    dispatch({
      type: "set scatterplot x",
      data: gene,
      isObs: isObs
    });
    e.stopPropagation();
  };

  handleSetGeneAsScatterplotY = (e) => {
    const { dispatch, gene, isObs } = this.props;
    dispatch({
      type: "set scatterplot y",
      data: gene,
      isObs: isObs
    });
    e.stopPropagation();
  };

  handleDeleteGeneFromSet = () => {
    const { dispatch, group, gene, geneset } = this.props;
    dispatch(actions.genesetDeleteGenes(group, geneset, [gene]));
  };

  toggleOff = () => {
    const { dispatch, gene } = this.props;
    dispatch({type: "unselect gene",gene})
  }
  toggleOn = () => {
    const { dispatch, gene } = this.props;
    dispatch({type: "select gene",gene})
  }  
  render() {
    const {
      dispatch,
      gene,
      geneDescription,
      isColorAccessor,
      isScatterplotXXaccessor,
      isScatterplotYYaccessor,
      removeHistZeros,
      removeGene,
      varMetadata,
      geneInfo,
      userLoggedIn,
      group,
      isSelected,
      rightWidth,
      allGenes,
      leftWidth,
      onRemoveClick,
      isObs,
      geneset,
      multiGeneSelect,
      parentGenes,
      lastClickedGene      
    } = this.props;
    const { geneIsExpanded, isHovered } = this.state;
    let geneSymbolWidth;
    if (isObs) {
      geneSymbolWidth = 60 + (geneIsExpanded ? MINI_HISTOGRAM_WIDTH : 40) + Math.max(0,(leftWidth - globals.leftSidebarWidth));
    } else {
      geneSymbolWidth = 60 + (geneIsExpanded ? MINI_HISTOGRAM_WIDTH : 0) + Math.max(0,(rightWidth - globals.rightSidebarWidth));
    }
    let trashHandler;
    if (isObs) {
      trashHandler = ()=>{onRemoveClick(gene)};
    } else {
      trashHandler = removeGene ? removeGene(gene,isColorAccessor,dispatch) : this.handleDeleteGeneFromSet;
    }

    return (
      <div draggable 
      onMouseOver={(e)=>this.setState({isHovered: true})}
      onMouseLeave={(e)=>this.setState({isHovered: false})}
      onDragStart={(e)=>{
        e.dataTransfer.setData("text",`${group}@@${geneset}@@@${gene}`)
        e.stopPropagation();
      }} style={{
          cursor: "pointer", 
          backgroundColor: isSelected && !isObs ? "#B4D5FE" : null,
          marginLeft: group !== "" ? globals.indentPaddingGeneset : 0,
        }}
        onClick={(e)=>{
        if ((!multiGeneSelect || !lastClickedGene) && !isSelected) {
          dispatch({type: "last clicked gene",gene})
        } else if(multiGeneSelect && !isSelected) {
          let first = null;
          let last = null;
          if (parentGenes.includes(lastClickedGene) && parentGenes.includes(gene)) {
            first = parentGenes.indexOf(lastClickedGene)
            last = parentGenes.indexOf(gene)
            if (first > last){
              const t = first;
              first = last;
              last = t;
            }
            dispatch({type: "select genes", genes:  parentGenes.slice(first,last)})
          }        
        } else if (isSelected && gene === lastClickedGene) {
          dispatch({type: "last clicked gene",gene: null})
        }
        isSelected ? this.toggleOff() : this.toggleOn()
      }}>
        <div
          style={{
            marginLeft: 0,
            marginRight: 0,
            marginTop: 2,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div
            role="menuitem"
            tabIndex="0"
            data-testclass="gene-expand"
            data-testid={`${gene}:gene-expand`}
            onKeyPress={() => {}}
            style={{
              cursor: "pointer",
              display: "flex",
              justifyContent: "space-between",
              width: "100%",
              margin: "auto 0"
            }}
          >
            <div style={{display: "flex", marginTop: "2px"}}>            
            <Truncate
              tooltipAddendum={geneDescription && !isObs && `: ${geneDescription}`}
            >
              <span
                style={{
                  width: geneSymbolWidth,
                  display: "inline-block",
                  paddingRight: "5px"
                }}
                className={styles.unselectable}
                data-testid={`${gene}:gene-label`}
              >
                {gene}
              </span>
            </Truncate>
            {!geneIsExpanded ? (
              <HistogramBrush
                isUserDefined
                field={gene}
                mini
                backgroundColor={isSelected && !isObs ? "#B4D5FE" : null}
                width={MINI_HISTOGRAM_WIDTH - (isObs ? 40 : 0)}
                removeHistZeros={removeHistZeros}
                isObs={isObs}
              />
            ) : null}            
            </div>
          </div>
          <div style={{ flexShrink: 0, marginLeft: 2 }}>
            {!allGenes && <Button
              minimal
              small
              data-testid={`delete-from-geneset-${gene}`}
              onClick={(e) => {trashHandler(); e.stopPropagation()}}
              intent="none"
              style={{ fontWeight: 700, marginRight: 2, visibility: isHovered ? undefined : "hidden" }}
              icon={<Icon icon="trash" iconSize={10} />}
            />}
            <Button
              minimal
              small
              data-testid={`plot-x-${gene}`}
              onClick={this.handleSetGeneAsScatterplotX}
              active={isScatterplotXXaccessor}
              intent={isScatterplotXXaccessor ? "primary" : "none"}
              style={{ fontWeight: 700, marginRight: 2, visibility: isHovered || isScatterplotXXaccessor  ? undefined : "hidden" }}
            >
              <span className={styles.unselectable}>x</span>
            </Button>
            <Button
              minimal
              small
              data-testid={`plot-y-${gene}`}
              onClick={this.handleSetGeneAsScatterplotY}
              active={isScatterplotYYaccessor}
              intent={isScatterplotYYaccessor ? "primary" : "none"}
              style={{ fontWeight: 700, marginRight: 2, visibility: isHovered || isScatterplotYYaccessor ? undefined : "hidden" }}
            >
              <span className={styles.unselectable}>y</span>
            </Button>
            <Button
              minimal
              small
              data-testclass="maximize"
              data-testid={`maximize-${gene}`}
              onClick={this.handleGeneExpandClick}
              active={geneIsExpanded}
              intent="none"
              icon={<Icon icon="maximize" iconSize={10} />}
              style={{ marginRight: 2, visibility: isHovered || geneIsExpanded ? undefined : "hidden" }}
            />
            <Button
              minimal
              small
              data-testclass="colorby"
              data-testid={`colorby-${gene}`}
              onClick={this.onColorChangeClick}
              active={isColorAccessor}
              intent={isColorAccessor ? "primary" : "none"}
              style={{visibility: isHovered || isColorAccessor ? undefined : "hidden"}}
              icon={<Icon icon="tint" iconSize={12} />}
            />
          </div>
        </div>
        {geneIsExpanded && !isObs && 
          <div style={{
              display: "flex",
              justifyContent: "space-between",
              width: "inherit",
              paddingTop:"5px",
              paddingBotton: "5px"
            }}>
            {(varMetadata !== "") && <div style={{margin: "0 auto"}}>
            {`${varMetadata}: ${geneInfo}`} 
            </div>}
            
          </div>}          
 
        {geneIsExpanded && <HistogramBrush isUserDefined field={gene} removeHistZeros={removeHistZeros} onRemoveClick={null} isObs={isObs}/>}
      </div>
    );
  }
}

export default Gene;
