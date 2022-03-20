import React from "react";
import { connect } from "react-redux";
import actions from "../../actions";
import FilenameDialog from "./filenameDialog";

@connect((state) => ({
  annotations: state.annotations,
  obsAnnotationSaveInProgress:
    state.autosave?.obsAnnotationSaveInProgress ?? false,
  genesetSaveInProgress: state.autosave?.genesetSaveInProgress ?? false,
  error: state.autosave?.error,
  writableCategoriesEnabled: state.config?.parameters?.annotations ?? false,
  writableGenesetsEnabled: !(
    state.config?.parameters?.annotations_genesets_readonly ?? true
  ),
  annoMatrix: state.annoMatrix,
  genesets: state.genesets,
  lastSavedAnnoMatrix: state.autosave?.lastSavedAnnoMatrix,
  lastSavedGenesets: state.autosave?.lastSavedGenesets,
  annoTracker: state.controls.annoTracker,
  undoed: state.controls.undoed
}))
class Autosave extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      timer: null,
    };
  }

  componentDidMount() {
    const { writableCategoriesEnabled, writableGenesetsEnabled } = this.props;

    let { timer } = this.state;
    if (timer) clearInterval(timer);
    if (writableCategoriesEnabled || writableGenesetsEnabled) {
      timer = setInterval(this.tick, 2500);
    } else {
      timer = null;
    }
    this.setState({ timer });
  }

  componentWillUnmount() {
    const { timer } = this.state;
    if (timer) clearInterval(timer);
  }

  tick = () => {
    const {
      dispatch,
      obsAnnotationSaveInProgress,
      genesetSaveInProgress
    } = this.props;
    if (!obsAnnotationSaveInProgress && this.needToSaveObsAnnotations()) {
      dispatch(actions.saveObsAnnotationsAction());
    }
    if (!genesetSaveInProgress && this.needToSaveGenesets()) {
      dispatch(actions.saveGenesetsAction());
    }
  };

  needToSaveObsAnnotations = () => {
    /* return true if we need to save obs cell labels, false if we don't */
    const { annoTracker, undoed } = this.props;
    return annoTracker.length > 0 || undoed;
  };

  needToSaveGenesets = () => {
    /* return true if we need to save gene ses, false if we do not */
    const { genesets, lastSavedGenesets } = this.props;
    return genesets.initialized && genesets.genesets !== lastSavedGenesets;
  };

  needToSave() {
    return this.needToSaveGenesets() || this.needToSaveObsAnnotations();
  }

  saveInProgress() {
    const { obsAnnotationSaveInProgress, genesetSaveInProgress } = this.props;
    return obsAnnotationSaveInProgress || genesetSaveInProgress;
  }

  statusMessage() {
    const { error } = this.props;
    if (error) {
      return `Autosave error: ${error}`;
    }
    return this.needToSave() ? "Unsaved" : "All saved";
  }

  render() {
    const {
      writableCategoriesEnabled,
      writableGenesetsEnabled,
      lastSavedAnnoMatrix,
    } = this.props;
    const initialDataLoadComplete = lastSavedAnnoMatrix;

    if (!writableCategoriesEnabled && !writableGenesetsEnabled) return null;

    return (
      <div
        id="autosave"
        data-testclass={
          !initialDataLoadComplete
            ? "autosave-init"
            : this.saveInProgress() || this.needToSave()
            ? "autosave-incomplete"
            : "autosave-complete"
        }
        style={{
          position: "absolute",
          display: "inherit",
          right: 8,
          bottom: 8,
          zIndex: 1,
        }}
      >
        {this.statusMessage()}
      </div>
    );
  }
}

export default Autosave;
