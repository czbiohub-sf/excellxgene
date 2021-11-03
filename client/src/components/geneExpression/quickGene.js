import { H4, Icon, MenuItem } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import React, { useMemo } from "react";
import fuzzysort from "fuzzysort";
import { Suggest } from "@blueprintjs/select";
import { connect } from "react-redux";
import Gene from "./gene";
import { postUserErrorToast } from "../framework/toasters";
import actions from "../../actions";



@connect((state) => {
  return {
    annoMatrix: state.annoMatrix,
    userDefinedGenes: state.controls.userDefinedGenes,
    userDefinedGenesLoading: state.controls.userDefinedGenesLoading,
  };
})
class QuickGene extends React.Component {
  constructor(props){
    super(props);
    this.state={isExpanded: true, geneNames: [], status: "pending"};
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

  handleActivateCreateGenesetMode = () => {
    const { dispatch } = this.props;
    dispatch({ type: "geneset: activate add new geneset mode" });
  };
  handleExpand = () => {
    this.setState({
      ...this.state,
      isExpanded: !this.state.isExpanded
    })
  }
  render() {
    const { dispatch, userDefinedGenes, userDefinedGenesLoading } = this.props;
    const { isExpanded, geneNames } = this.state;

    return (
      <div style={{ width: "100%", marginBottom: "16px" }}>
      <H4
        role="menuitem"
        tabIndex="0"
        data-testclass="quickgene-heading-expand"
        onKeyPress={this.handleExpand}
        style={{
          cursor: "pointer",
        }}
        onClick={this.handleExpand}
      >
        Genes{" "}
        {isExpanded ? (
          <Icon icon={IconNames.CHEVRON_DOWN} />
        ) : (
          <Icon icon={IconNames.CHEVRON_RIGHT} />
        )}
      </H4>
      {isExpanded && (
        <>
          <div style={{ marginBottom: "8px" }}>
            <Suggest
              resetOnSelect
              closeOnSelect
              resetOnClose
              itemDisabled={userDefinedGenesLoading ? () => true : () => false}
              noResults={<MenuItem disabled text="No matching genes." />}
              onItemSelect={(g) => {
                this.handleClick(g);
              }}
              initialContent={<MenuItem disabled text="Enter a gene…" />}
              inputProps={{
                "data-testid": "gene-search",
                placeholder: "Quick Gene Search",
                leftIcon: IconNames.SEARCH,
                fill: true,
              }}
              inputValueRenderer={() => ""}
              itemListPredicate={this.filterGenes}
              itemRenderer={this.renderGene}
              items={geneNames || ["No genes"]}
              popoverProps={{ minimal: true }}
              fill
            />
          </div>
          <QuickGenes dispatch={dispatch} userDefinedGenes={userDefinedGenes}/>
        </>
      )}
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
  const { dispatch, userDefinedGenes } = props;
  const [ renderedGenes, setRenderedGenes ] = React.useState(null)

  React.useEffect(() => {
    setRenderedGenes(userDefinedGenes.map((gene) => (
      <Gene
        key={`quick=${gene}`}
        gene={gene}
        removeGene={removeGene}
      />
    )))
  }, [userDefinedGenes])

  return renderedGenes;
});

export default QuickGene;