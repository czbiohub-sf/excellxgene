import pull from "lodash.pull";
import uniq from "lodash.uniq";
import React from "react";
import { connect } from "react-redux";
import { Button, Dialog, Classes, Colors } from "@blueprintjs/core";
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
  geneSelection: Object.keys(state.geneSelection)
}))
class CreateGenesetDialogue extends React.PureComponent {
  constructor(props) {
    super(props);
    this.state = {
      genesetName: "",
      genesToPopulateGeneset: "",
      genesetDescription: "",
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
    const { dispatch , geneSelection} = this.props;
    const {
      genesetName,
      genesToPopulateGeneset,
      genesetDescription,
    } = this.state;

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
      geneSelection.forEach((_gene) => {
        genesTmpHardcodedFormat.push(_gene);
      });
      dispatch(actions.genesetAddGenes(genesetDescription, genesetName, genesTmpHardcodedFormat));
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
    const error = AnnotationsHelpers.annotationNameIsErroneous(genesetName);
    return labelPrompt(
      error,
      this.validate(genesetDescription, genesetName, genesets)
      ? "Gene set name must be unique."
      : "New, unique gene set name",
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
      `Optionally add a group name for this gene set`,
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
    const { genesetDescription, genesetName } = this.state;
    const { metadataField, genesetsUI, genesets } = this.props;

    return (
      <>
        <Dialog
          icon="tag"
          title="Create gene set"
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
                    autoFocus: true,
                  }}
                  newLabelMessage="Create gene set"
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
                  newLabelMessage="Add geneset group name"
                />

                <p style={{ marginTop: 20 }}>
                  Optionally add a list of comma separated{" "}
                  <span style={{ fontWeight: 700 }}>genes</span> to populate the
                  gene set
                </p>
                <LabelInput
                  onChange={this.handleGenesetInputChange}
                  inputProps={{
                    "data-testid": "add-genes",
                    intent: "none",
                    autoFocus: false,
                  }}
                  newLabelMessage="populate geneset with genes"
                />
                <p style={{ marginTop: 20 }}>
                <span style={{ fontWeight: 700 }}>OR</span>{" "} leave empty to populate the
                geneset with the currently selected genes.
                </p>                
              </div>
            </div>
            <div className={Classes.DIALOG_FOOTER}>
              <div className={Classes.DIALOG_FOOTER_ACTIONS}>
                <Tooltip2 content="Close this dialog without creating a new gene set.">
                  <Button onClick={this.disableCreateGenesetMode}>
                    Cancel
                  </Button>
                </Tooltip2>
                <Button
                  data-testid={`${metadataField}:submit-geneset`}
                  onClick={this.createGeneset}
                  disabled={
                    !genesetName || this.validate(genesetDescription, genesetName, genesets) || this.validate1(genesetName) || this.validate2(genesetDescription)
                  }
                  intent="primary"
                  type="submit"
                >
                  Create gene set
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
