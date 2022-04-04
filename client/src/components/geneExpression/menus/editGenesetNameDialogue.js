import React from "react";
import { connect } from "react-redux";
import AnnoDialog from "../../annoDialog";
import LabelInput from "../../labelInput";
import actions from "../../../actions";
@connect((state) => ({
  annotations: state.annotations,
  schema: state.annoMatrix?.schema,
  ontology: state.ontology,
  obsCrossfilter: state.obsCrossfilter,
  genesetsUI: state.genesetsUI,
  cxgMode: state.controls.cxgMode
}))
class RenameGeneset extends React.PureComponent {
  constructor(props) {
    super(props);
    this.state = {
      newGenesetName: props.parentGeneset,
      newGenesetDescription: props.parentGenesetDescription?.split('//;;//').at(0),
    };
  }

  disableEditGenesetNameMode = (e) => {
    const { dispatch } = this.props;
    this.setState({
      newGenesetName: "",
      newGenesetDescription: "",
    });
    dispatch({
      type: "geneset: disable rename geneset mode",
    });
    if (e) e.preventDefault();
  };

  renameGeneset = (e) => {
    const { dispatch, genesetsUI } = this.props;
    const { newGenesetName, newGenesetDescription } = this.state;

    dispatch({
      type: "geneset: update",
      genesetDescription: genesetsUI.isEditingGenesetGroup,
      genesetName: genesetsUI.isEditingGenesetName,
      update: {
        genesetName: newGenesetName,
        genesetDescription: newGenesetDescription,
      },
    });
    dispatch(actions.requestGeneSetRename(genesetsUI.isEditingGenesetGroup,newGenesetDescription,genesetsUI.isEditingGenesetName, newGenesetName));
    dispatch({
      type: "geneset: disable rename geneset mode",
    });
    e.preventDefault();
  };

  genesetNameError = () => {
    return false;
  };

  handleChange = (e) => {
    this.setState({ newGenesetName: e});
  };

  handleChangeDescription = (e) => {
    this.setState({ newGenesetDescription: e });
  };

  render() {
    const { newGenesetName, newGenesetDescription } = this.state;
    const { genesetsUI, parentGeneset, parentGenesetDescription, cxgMode } = this.props;
    const cOrG = cxgMode === "OBS" ? "gene" : "cell";
    let name = "";
    if (genesetsUI.isEditingGenesetName) {
      name = genesetsUI.isEditingGenesetName;
    }
    const gname = parentGenesetDescription ?? "";
    return (
      <>
        <AnnoDialog
          isActive={genesetsUI.isEditingGenesetName === parentGeneset}
          inputProps={{
            "data-testid": `${genesetsUI.isEditingGenesetName}:rename-geneset-dialog`,
          }}
          primaryButtonProps={{
            "data-testid": `${genesetsUI.isEditingGenesetName}:submit-geneset`,
          }}
          title={gname.includes('//;;//') ? `Edit ${cOrG} set name` : `Edit ${cOrG} set name and grouping`}
          instruction={`Rename ${name}`}
          cancelTooltipContent={`Close this dialog without renaming the ${cOrG} set.`}
          primaryButtonText={gname.includes('//;;//') ? `Edit ${cOrG} set name` : `Edit ${cOrG} set name and grouping`}
          text={newGenesetName}
          secondaryText={newGenesetDescription}
          validationError={
            genesetsUI.isEditingGenesetName === newGenesetName &&
            parentGenesetDescription === newGenesetDescription
          }
          annoInput={
            <LabelInput
              label={newGenesetName}
              onChange={this.handleChange}
              inputProps={{
                "data-testid": "rename-geneset-modal",
                leftIcon: "manually-entered-data",
                intent: "none",
                autoFocus: true,
              }}
            />
          }
          secondaryInstructions={gname.includes('//;;//') ? null : `Edit ${cOrG} group name`}
          secondaryInput={
            gname.includes('//;;//') ? null : <LabelInput
              label={newGenesetDescription}
              onChange={this.handleChangeDescription}
              inputProps={{ "data-testid": "change geneset description" }}
              intent="none"
              autoFocus={false}
            />
          }
          handleSubmit={this.renameGeneset}
          handleCancel={this.disableEditGenesetNameMode}
        />
      </>
    );
  }
}

export default RenameGeneset;
