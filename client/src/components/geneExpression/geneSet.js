import React from "react";
import { connect } from "react-redux";
import { Icon, Button, AnchorButton } from "@blueprintjs/core";
import LabelInput from "../labelInput";
import { FaChevronRight, FaChevronDown } from "react-icons/fa";
import actions from "../../actions";
import Gene from "./gene";
import { memoize } from "../../util/dataframe/util";
import Truncate from "../util/truncate";
import * as globals from "../../globals";
import GenesetMenus from "./menus/genesetMenus";
import EditGenesetNameDialogue from "./menus/editGenesetNameDialogue";
import HistogramBrush from "../brushableHistogram";

@connect((state) => {
  return {
    world: state.world,
    userDefinedGenes: state.controls.userDefinedGenes,
    userDefinedGenesLoading: state.controls.userDefinedGenesLoading,
  };
})
class GeneSet extends React.Component {
  _memoGenesToUpper = memoize(this._genesToUpper, (arr) => arr);

  constructor(props) {
    super(props);
    this.state = {
      isOpen: false,
      genePage: 0,
      maxGenePage: Math.ceil((props.setGenes.length-0.1) / 10) - 1,
      removeHistZeros: false,
      queryGene: "",
    };
  }

  _genesToUpper = (listGenes) => {
    // Has to be a Map to preserve index
    const upperGenes = new Map();
    for (let i = 0, { length } = listGenes; i < length; i += 1) {
      upperGenes.set(listGenes[i].toUpperCase(), i);
    }

    return upperGenes;
  };

  fetchGenes = () => {
    const { world, dispatch, setGenes } = this.props;
    const varIndexName = world.schema.annotations.var.index;

    const worldGenes = world.varAnnotations.col(varIndexName).asArray();

    const upperGenes = this._genesToUpper(setGenes);
    const upperWorldGenes = this._memoGenesToUpper(worldGenes);

    dispatch({ type: "bulk user defined gene start" });

    Promise.all(
      [...upperGenes.keys()].map((upperGene) => {
        const indexOfGene = upperWorldGenes.get(upperGene);

        return dispatch(
          actions.requestUserDefinedGene(worldGenes[indexOfGene])
        );
      })
    ).then(
      () => dispatch({ type: "bulk user defined gene complete" }),
      () => dispatch({ type: "bulk user defined gene error" })
    );

    return undefined;
  };

  componentDidUpdate = (prevProps) => {
    const { setGenes } = this.props;
    const { setGenes: setGenesPrev } = prevProps;
    if (setGenes !== setGenesPrev) {
      this.setState({
        ...this.state,
        maxGenePage: Math.ceil((setGenes.length-0.1) / 10) - 1,
      })
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
    this.setState({ isOpen: !isOpen });
  };


  renderGenes() {
    const { setName, setGenes, setGenesWithDescriptions } = this.props;
    const { genePage, removeHistZeros } = this.state;
    return setGenes.slice(genePage*10,(genePage+1)*10).map((gene) => {
      const { geneDescription } = setGenesWithDescriptions.get(gene);

      return (
        <Gene
          key={gene}
          gene={gene}
          geneDescription={geneDescription}
          geneset={setName}
          removeHistZeros={removeHistZeros}
        />
      );
    });
  }

  render() {
    const { setName, setGenes, genesetDescription, displayLabel } = this.props;
    const { isOpen, maxGenePage, genePage, removeHistZeros, queryGene } = this.state;
    const genesetNameLengthVisible = 150; /* this magic number determines how much of a long geneset name we see */
    const genesetIsEmpty = setGenes.length === 0;

    return (
      <div style={{ marginBottom: 3 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            backgroundColor: "#E0E0E0	",
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
          <div>
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
              />
          </div>
        </div>

        <div style={{ marginLeft: 15, marginTop: 5, marginRight: 0 }}>
          {isOpen && genesetIsEmpty && (
            <p style={{ fontStyle: "italic", color: "lightgrey" }}>
              No genes to display
            </p>
          )}
        </div>
        {isOpen && !genesetIsEmpty && setGenes.length > 0 && (
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
