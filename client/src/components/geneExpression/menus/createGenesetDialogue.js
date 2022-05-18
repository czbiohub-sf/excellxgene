import pull from "lodash.pull";
import uniq from "lodash.uniq";
import React from "react";
import { connect } from "react-redux";
import { Button, Dialog, Classes, Colors, AnchorButton, MenuItem, ControlGroup, Checkbox } from "@blueprintjs/core";
import { Select } from "@blueprintjs/select";
import { Tooltip2 } from "@blueprintjs/popover2";
import LabelInput from "../../labelInput";
import { AnnotationsHelpers } from "../../../util/stateManager";
import { labelPrompt } from "../../categorical/labelUtil";
import actions from "../../../actions";

@connect((state) => ({
  annotations: state.annotations,
  schema: state.annoMatrix?.schema,
  ontology: state.ontology,
  obsCrossfilter: state.obsCrossfilter,
  genesets: state.genesets.genesets,
  genesetsUI: state.genesetsUI,
  selectedGenesLasso: state.genesets.selectedGenesLasso,
  geneSelection: [...state.geneSelection.genes],
  cOrG: state.controls.cxgMode === "OBS" ? "gene" : "cell"
}))
class CreateGenesetDialogue extends React.PureComponent {
  constructor(props) {
    super(props);
    this.state = {
      genesetName: "",
      genesToPopulateGeneset: "",
      genesetDescription: "",
      initGroup: "",
      initSet: "All genesets",
      doInitialize: false
    };
  }

  disableCreateGenesetMode = (e) => {
    const { dispatch } = this.props;
    this.setState({
      genesetName: "",
      genesToPopulateGeneset: "",
      genesetDescription: "",
    });
    dispatch({
      type: "geneset: disable create geneset mode",
    });
    if (e) e.preventDefault();
  };

  createGeneset = (e) => {
    const { dispatch , geneSelection, selectedGenesLasso, genesets} = this.props;
    const selectedGenes = [...new Set([...geneSelection,...selectedGenesLasso])];

    const {
      genesetName,
      genesToPopulateGeneset,
      genesetDescription,
      doInitialize,
      initGroup,
      initSet
    } = this.state;

    if (!doInitialize) {
      dispatch({
        type: "geneset: create",
        genesetName,
        genesetDescription,
      });      
      if (genesToPopulateGeneset) {
        const genesTmpHardcodedFormat = [];
  
        const genesArrayFromString = pull(
          uniq(genesToPopulateGeneset.split(/[ ,]+/)),
          ""
        );
  
        genesArrayFromString.forEach((_gene) => {
          genesTmpHardcodedFormat.push(_gene);
        });
  
        dispatch(actions.genesetAddGenes(genesetDescription, genesetName, genesTmpHardcodedFormat));
      } else {
        const genesTmpHardcodedFormat = [];
        selectedGenes.forEach((_gene) => {
          genesTmpHardcodedFormat.push(_gene);
        });
        dispatch(actions.genesetAddGenes(genesetDescription, genesetName, genesTmpHardcodedFormat));
      }
    } else {
      if (initSet === "All genesets"){
        Object.keys(genesets[initGroup]).forEach((item)=>{
          dispatch({
            type: "geneset: create",
            genesetName: item,
            genesetDescription,
          });          
          dispatch(actions.genesetAddGenes(genesetDescription, item, genesets[initGroup][item]));
        })
      } else {
        dispatch({
          type: "geneset: create",
          genesetName,
          genesetDescription,
        });        
        dispatch(actions.genesetAddGenes(genesetDescription, genesetName, genesets[initGroup][initSet]));
      }
    }

    dispatch({
      type: "geneset: disable create geneset mode",
    });
    this.setState({
      genesetName: "",
      genesToPopulateGeneset: "",
      genesetDescription: ""
    });
    e.preventDefault();
  };

  genesetNameError = () => {
    return false;
  };

  handleChange = (e) => {
    this.setState({ genesetName: e});
  };

  handleGenesetInputChange = (e) => {
    this.setState({ genesToPopulateGeneset: e });
  };

  handleDescriptionInputChange = (e) => {
    this.setState({ genesetDescription: e });
  };

  instruction = (genesetDescription, genesetName, genesets) => {
    const { doInitialize, initSet } = this.state;
    let error = AnnotationsHelpers.annotationNameIsErroneous(genesetName);
    if (doInitialize && initSet === "All genesets" && error === "empty-string") {
      error = false;
    }
    return labelPrompt(
      error,
      this.validate(genesetDescription, genesetName, genesets)
      ? "Gene set name must be unique"
      : `New, unique ${this.props.cOrG} set name`,
      ":"
    );    
  };
  instruction2 = (genesetDescription) => {
    let error = AnnotationsHelpers.annotationNameIsErroneous(genesetDescription);
    if (error === "empty-string") {
      error = false;
    }
    return labelPrompt(
      error,
      `Optionally add a group name for this ${this.props.cOrG} set`,
      ":"
    );    
  };
  validate = (genesetDescription, genesetName, genesets) => {
    if (genesetDescription in genesets) {
      if (genesetName in genesets[genesetDescription]) {
        return true;
      }
    }
    return false;
  };

  validate1 = (genesetName) => {
    return AnnotationsHelpers.annotationNameIsErroneous(genesetName)
  }

  validate2 = (genesetDescription) => {
    let error = AnnotationsHelpers.annotationNameIsErroneous(genesetDescription);
    if (error === "empty-string") {
      error = false;
    }
    return error;
  }

  render() {
    const { genesetDescription, genesetName, initGroup, initSet, doInitialize } = this.state;
    const { metadataField, genesetsUI, genesets } = this.props;
    const notReady = !doInitialize || Object.keys(genesets?.[initGroup] ?? {}).length === 0
    return (
      <>
        <Dialog
          icon="tag"
          title={`Create ${this.props.cOrG} set`}
          isOpen={genesetsUI.createGenesetModeActive}
          onClose={this.disableCreateGenesetMode}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
            }}
          >
            <div className={Classes.DIALOG_BODY}>
              <div style={{ marginBottom: 20 }}>
                <p>{this.instruction(genesetDescription, genesetName, genesets)}</p>
                <LabelInput
                  onChange={this.handleChange}
                  inputProps={{
                    "data-testid": "create-geneset-modal",
                    leftIcon: "manually-entered-data",
                    intent: "none",
                    disabled: (doInitialize && (initSet ?? "All genesets") === "All genesets"),
                    autoFocus: true,
                  }}
                  newLabelMessage={`Create ${this.props.cOrG} set`}
                />
                <p
                  style={{
                    marginTop: 7,
                    visibility: this.validate(genesetDescription, genesetName, genesets)
                      ? "visible"
                      : "hidden",
                    color: Colors.ORANGE3,
                  }}
                >
                  {this.genesetNameError()}
                </p>
                <p style={{ marginTop: 20 }}>
                  {this.instruction2(genesetDescription)}
                </p>
                <LabelInput
                  onChange={this.handleDescriptionInputChange}
                  inputProps={{
                    "data-testid": "add-geneset-description",
                    intent: "none",
                    autoFocus: false,
                  }}
                  newLabelMessage={`Add ${this.props.cOrG} set group name`}
                />

                <p style={{ marginTop: 20 }}>
                  Optionally add a list of comma separated{" "}
                  <span style={{ fontWeight: 700 }}>{this.props.cOrG}s</span> to populate the
                   {" "}{this.props.cOrG} set
                </p>
                <LabelInput
                  onChange={this.handleGenesetInputChange}
                  inputProps={{
                    "data-testid": "add-genes",
                    intent: "none",
                    autoFocus: false,
                    disabled: doInitialize
                  }}
                  newLabelMessage={`populate ${this.props.cOrG} set with ${this.props.cOrG}s`}
                />
                <p style={{ marginTop: 20 }}>
                <span style={{ fontWeight: 700 }}>OR</span>{" "} leave empty to populate the
                {" "}{this.props.cOrG} set with the currently selected {this.props.cOrG}s.
                </p>                
                <p style={{ marginTop: 20 }}>
                <span style={{ fontWeight: 700 }}>OR</span>{" "} initialize
                {" "}{this.props.cOrG} set an existing set:
                </p>    
                <ControlGroup style={{columnGap: "20px"}}>
                  <Checkbox style={{paddingTop: "5px"}} checked={doInitialize} label="Initialize from existing"
                    onChange={() => {    
                      this.setState({doInitialize: !doInitialize})
                      }
                    } 
                  />                                            
                  <Select
                  style={{minWidth: "100px"}}                  
                    disabled={!doInitialize}
                    items={
                      Object.keys(genesets)
                    }
                    filterable={false}
                    itemRenderer={(d, { handleClick }) => {
                      return (
                        <MenuItem
                          style={{minWidth: "100px"}}
                          onClick={handleClick}
                          key={d}
                          text={d === "" ? "Ungrouped" : d.split('//;;//').at(0)}
                        />
                      );
                    }}
                    onItemSelect={(d) => {
                      this.setState({initGroup: d, initSet: "All genesets"})
                    }}
                  >
                    <AnchorButton
                      disabled={!doInitialize}
                      text={`${initGroup === "" ? "Ungrouped" : initGroup?.split("//;;//")?.at(0)}`}
                      rightIcon="double-caret-vertical"
                      style={{minWidth: "100px"}}
                    />
                  </Select>   
                  <Select
                    style={{minWidth: "100px"}}
                    disabled={!doInitialize || Object.keys(genesets?.[initGroup] ?? {}).length === 0}
                    items={
                      ["All genesets"].concat(Object.keys(genesets?.[initGroup] ?? {}))
                    }
                    filterable={false}
                    itemRenderer={(d, { handleClick }) => {
                      return (
                        <MenuItem
                          style={{minWidth: "100px"}}
                          onClick={handleClick}
                          key={d}
                          text={d}
                        />
                      );
                    }}
                    onItemSelect={(d) => {
                      this.setState({initSet: d})
                    }}
                  >
                    <AnchorButton
                      disabled={notReady}
                      text={`${initSet ?? "All genesets"}`}
                      rightIcon="double-caret-vertical"
                      style={{minWidth: "100px"}}
                    />
                  </Select> 
              </ControlGroup>                                   
              </div>
            </div>
            <div className={Classes.DIALOG_FOOTER}>
              <div className={Classes.DIALOG_FOOTER_ACTIONS}>
                <Tooltip2 content={`Close this dialog without creating a new ${this.props.cOrG} set.`}>
                  <Button onClick={this.disableCreateGenesetMode}>
                    Cancel
                  </Button>
                </Tooltip2>
                <Button
                  data-testid={`${metadataField}:submit-geneset`}
                  onClick={this.createGeneset}
                  disabled={
                    (doInitialize && notReady) || this.validate(genesetDescription, genesetName, genesets) || (!genesetName || this.validate1(genesetName)) && (!doInitialize || initSet !== "All genesets") || this.validate2(genesetDescription)
                  }
                  intent="primary"
                  type="submit"
                >
                  Create {this.props.cOrG} set
                </Button>
              </div>
            </div>
          </form>
        </Dialog>
      </>
    );
  }
}

export default CreateGenesetDialogue;
