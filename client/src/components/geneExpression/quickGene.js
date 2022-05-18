import { MenuItem, Button, Icon, AnchorButton, Tooltip } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import React from "react";
import { Popover2 } from "@blueprintjs/popover2";
import fuzzysort from "fuzzysort";
import { Suggest } from "@blueprintjs/select";
import { connect } from "react-redux";
import Gene from "./gene";
import { postUserErrorToast } from "../framework/toasters";
import actions from "../../actions";
import LabelInput from "../labelInput";
import pull from "lodash.pull";
import uniq from "lodash.uniq";
import * as globals from "../../globals"

@connect((state) => {
  return {
    annoMatrix: state.annoMatrix,
    userDefinedGenes: state.controls.userDefinedGenes,
    userDefinedGenesLoading: state.controls.userDefinedGenesLoading
  };
})
class QuickGene extends React.Component {
  constructor(props){
    super(props);
    this.state={ geneNames: [], status: "pending", inputString: "", commaModeActivated: false, newDescription: "", isPopoverOpen: false};
  }
  
  componentDidMount = () => {
    const { annoMatrix } = this.props;
    this.setGeneNames(annoMatrix);
  }

  renderGene = (
    fuzzySortResult,
    { handleClick, modifiers }
  ) => {
    if (!modifiers.matchesPredicate) {
      return null;
    }
    /* the fuzzysort wraps the object with other properties, like a score */
    const geneName = fuzzySortResult.target;

    return (
      <MenuItem
        active={modifiers.active}
        disabled={modifiers.disabled}
        data-testid={`suggest-menu-item-${geneName}`}
        key={geneName}
        onClick={(g) =>
          handleClick(g)
        }
        text={geneName}
      />
    );
  };

  handleClick = (g) => {
    const { dispatch, userDefinedGenes } = this.props;
    const { geneNames } = this.state;
    if (!g) return;
    const gene = g.target;
    if (userDefinedGenes.indexOf(gene) !== -1) {
      postUserErrorToast("That gene already exists");
    } else if (geneNames.indexOf(gene) === undefined) {
      postUserErrorToast("That doesn't appear to be a valid gene name.");
    } else {
      dispatch(actions.genesetAddGenes("", "Gene search results", [gene]));
      dispatch({type: "track set", group: "", set: "Gene search results"})
    }
  };

  filterGenes = (query, genes) =>
    fuzzysort.go(query, genes, {
      limit: 5,
      threshold: -10000, // don't return bad results
    });


  componentDidUpdate(prevProps) {
    const { annoMatrix } = this.props;
    const { inputString, commaModeActivated } = this.state;
    if (!commaModeActivated && inputString.includes(',')){
      this.setState({commaModeActivated: true})
    }
    if(annoMatrix !== prevProps.annoMatrix){
      this.setGeneNames(annoMatrix);
    }
  }
  
  setGeneNames = (annoMatrix) => {
    const { schema } = annoMatrix;
    const varIndex = schema.annotations.var.index;
    this.setState({
      ...this.state,
      status: "pending"
    })
    try {
      annoMatrix.fetch("var", varIndex).then((val)=>{
        this.setState({
          ...this.state,
          status: "success",
          geneNames: val.col(varIndex).asArray()
        })  
      });
    } catch (error) {
      this.setState({
        ...this.state,
        status: "error"
      });
      throw error;
    }
  }
  handleAddGenes = () => {
    const { dispatch } = this.props;
    const { inputString: genesToPopulateGeneset, geneNames } = this.state;

    const genesArrayFromString = pull(
      uniq(genesToPopulateGeneset.split(/[ ,]+/)),
      ""
    );

    const genesToAdd=[];
    genesArrayFromString.forEach((_gene) => {
      if (geneNames.includes(_gene)) {
        genesToAdd.push(_gene);
      }
    });
    dispatch(actions.genesetAddGenes("", "Gene search results", genesToAdd));
    dispatch({type: "track set", group: "", set: "Gene search results"})
  }
  handleTextChange = (e) => {
    this.setState({inputString: e})
  }

  handleActivateCreateGenesetMode = () => {
    const { dispatch } = this.props;
    dispatch({ type: "geneset: activate add new geneset mode" });
  };

  render() {
    const { dispatch, userDefinedGenes, userDefinedGenesLoading, rightWidth, openPreferences } = this.props;
    const { geneNames, inputString, commaModeActivated, isPopoverOpen } = this.state;
    const noCommaInput = !inputString.includes(",")

    return (
      <div style={{ width: "100%"}}>
        <>
          <div style={{ display: "flex", flexDirection: "row", columnGap: "5px" }}>
            <Tooltip
              content="Expression preferences"
              position="bottom"
              hoverOpenDelay={globals.tooltipHoverOpenDelay}
            >
                <AnchorButton icon="cog"
                  onClick={openPreferences}
                />
            </Tooltip>                
            {noCommaInput ? <Suggest
              resetOnSelect
              closeOnSelect
              itemDisabled={userDefinedGenesLoading ? () => true : () => false}
              noResults={<MenuItem disabled text="No matching genes." />}
              onItemSelect={(g) => {
                this.handleClick(g);
              }}
              initialContent={<MenuItem disabled text="Enter a gene…" />}
              inputProps={{
                "data-testid": "gene-search",
                placeholder: "Add gene(s)",
                leftIcon: IconNames.SEARCH,
                fill: true,
                autoFocus: inputString!=="" && commaModeActivated
              }}
              onQueryChange={this.handleTextChange}
              query={inputString}
              inputValueRenderer={() => ""}
              itemListPredicate={this.filterGenes}
              itemRenderer={this.renderGene}
              items={geneNames || ["No genes"]}
              popoverProps={{ minimal: true }}
              fill
            /> : <LabelInput
              onChange={this.handleTextChange}
              inputProps={{
                placeholder: "Add gene(s)",
                leftIcon: IconNames.SEARCH,
                fill: true,
                autoFocus: true,
                onKeyDown: (e)=>{
                  if (e.key==="Enter"){
                    this.handleAddGenes(e.target.value)
                    this.setState({
                      inputString: ""
                    })                    
                    e.target.blur();
                  } else if (e.key === "Escape") {
                    e.target.blur();
                  }
                }
              }}
              label={inputString}
              
            />}
            <Popover2 isOpen={isPopoverOpen} position="bottom-right" content={
              <div style={{display: 'flex', flexDirection: 'row', justifyContent: "left", textAlign: "left", width: 200}}>
                <LabelInput
                  onChange={(e) => {
                    this.setState({newDescription: e})
                  }}
                  inputProps={{
                    placeholder: "New group",
                    style: {border: 0, boxShadow: 'none'},
                    fill: true,
                    autoFocus: true,
                    onBlur: (e) => {
                      if (e.relatedTarget?.id !== "add-group-button") {
                        this.setState({isPopoverOpen: false})
                      }                      
                    },
                    onKeyDown: (e)=>{
                      const { dispatch } = this.props;
                      const { newDescription } = this.state;
                      if (e.key==="Enter" && e.target.value !== ""){
                        dispatch({
                          type: "geneset: create",
                          genesetName: null,
                          genesetDescription: newDescription
                        });
                        
                        this.setState({newDescription: "", isPopoverOpen: false})
                      } else if (e.key==="Escape") {
                        this.setState({isPopoverOpen: false})
                      }
                    },
                  }}
                /> 
            </div>}>
                <Button id="add-group-button" style={{color: "gray", width: "10%"}} active={isPopoverOpen} onClick={()=>this.setState({isPopoverOpen: !isPopoverOpen})}
                        icon={<Icon icon="plus" style={{ color: "gray", padding: 0, margin: 0 }} />}>
                </Button>      
            </Popover2>                                  
                    
          </div>
          <div>
          </div>    
        </>
    </div>    
      );
  }
}

const removeGene = (gene,isColorAccessor,dispatch) => () => {
  dispatch({ type: "clear user defined gene", data: gene });
  if (isColorAccessor) {
    dispatch({ type: "color by expression", gene });
  }
};
const QuickGenes = React.memo((props) => {
  const { dispatch, userDefinedGenes, rightWidth } = props;
  const [ renderedGenes, setRenderedGenes ] = React.useState(null)

  React.useEffect(() => {
    setRenderedGenes(userDefinedGenes.map((gene) => (
      <Gene
        key={`quick=${gene}`}
        gene={gene}
        removeGene={removeGene}
        rightWidth={rightWidth}
      />
    )))
  }, [userDefinedGenes, rightWidth])

  return renderedGenes;
});

export default QuickGene;