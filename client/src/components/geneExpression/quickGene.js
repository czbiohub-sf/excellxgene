import { MenuItem, Button, Icon, AnchorButton, Tooltip } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import React from "react";
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
    this.state={ geneNames: [], status: "pending", inputString: "", commaModeActivated: false, newFolder: null, newDescription: ""};
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
  addFolder = () => {
    const newFolder = (
        <div style={{display: 'flex', flexDirection: 'row', justifyContent: "left", textAlign: "left"}}>
        <AnchorButton icon="chevron-right" minimal/>
          <LabelInput
            onChange={(e) => {
              this.setState({newDescription: e})
            }}
            inputProps={{
              placeholder: "New group",
              fill: true,
              autoFocus: true,
              onKeyDown: (e)=>{
                const { dispatch } = this.props;
                const { newDescription } = this.state;
                if (e.key==="Enter" && e.target.value !== ""){
                  dispatch({
                    type: "geneset: create",
                    genesetName: null,
                    genesetDescription: newDescription
                  });
                  
                  this.setState({newFolder: null, newDescription: ""})
                }
              },
              onBlur: (e) => {
                this.setState({newFolder: null})
              }
            }}
          />
        </div>
    );
    this.setState({newFolder})
  }

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
      dispatch({ type: "single user defined gene start" });
      dispatch(actions.requestUserDefinedGene(gene));
      dispatch({ type: "single user defined gene complete" });
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

    genesArrayFromString.forEach((_gene) => {
      if (geneNames.includes(_gene)) {
        dispatch({ type: "single user defined gene start" });
        dispatch(actions.requestUserDefinedGene(_gene));
        dispatch({ type: "single user defined gene complete" });      

      }
    });

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
    const { geneNames, inputString, commaModeActivated, newFolder } = this.state;
    const noCommaInput = !inputString.includes(",")

    return (
      <div style={{ width: "100%", marginBottom: "16px" }}>
        <>
          <div style={{ marginBottom: "8px", display: "flex", flexDirection: "row", columnGap: "5px" }}>
            <Tooltip
              content="Expression preferences"
              position="bottom"
              hoverOpenDelay={globals.tooltipHoverOpenDelay}
            >
                <AnchorButton icon="cog" style={{marginBottom: "16px"}}
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
                autoFocus: commaModeActivated
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
                  }
                }
              }}
              label={inputString}
              
            />}
            {/*<Popover2 position="bottom-right" content={<div style={{display: 'flex', flexDirection: 'column'}}
            >
              <AnchorButton
                onClick={(e) => {
                  this.addGeneSet();
                  const { parentElement } = e.target
                  parentElement.classList.add(Classes.POPOVER_DISMISS)
                  parentElement.click()                  
                }}
                text={<span style={{color: "gray"}}>Gene Set</span>}
                minimal
              />
              <AnchorButton
                onClick={(e) => {
                  this.addGeneSetGroup(); 
                  const { parentElement } = e.target
                  parentElement.classList.add(Classes.POPOVER_DISMISS)
                  parentElement.click()                  
                }}
                text={<span style={{color: "gray"}}>Gene Set Group</span>}
                minimal
              />              
            </div>}>
                <Button style={{color: "gray", width: "10%"}} 
                        icon={<Icon icon="plus" style={{ color: "gray", padding: 0, margin: 0 }} />}>
                </Button>      
            </Popover2>*/}
            <Tooltip
              content="Create group"
              position="bottom"
              hoverOpenDelay={globals.tooltipHoverOpenDelay}
            >
              <Button style={{color: "gray", width: "10%"}} 
                      onClick={this.addFolder}
                      icon={<Icon icon="plus" style={{ color: "gray", padding: 0, margin: 0 }} />}>
              </Button> 
            </Tooltip>                                    
                    
          </div>
          <div style={{position: "absolute", left: 5}}>
          <QuickGenes dispatch={dispatch} userDefinedGenes={userDefinedGenes} rightWidth={rightWidth}/>
          </div>    
        </>
      {newFolder}        
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