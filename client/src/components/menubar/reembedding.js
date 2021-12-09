import React from "react";
import { connect } from "react-redux";
import {
  AnchorButton,
  ButtonGroup,
  Tooltip,
  Dialog,
  ControlGroup,
  Button
} from "@blueprintjs/core";
import * as globals from "../../globals";
import actions from "../../actions";
import styles from "./menubar.css";
import DimredPanel from "./dimredpanel";
import PrepPanel from "./preppanel";

@connect((state) => ({
  reembedController: state.reembedController,
  preprocessController: state.preprocessController,
  reembedParams: state.reembedParameters,
  annoMatrix: state.annoMatrix,
  idhash: state.config?.parameters?.["annotations-user-data-idhash"] ?? null,
  obsCrossfilter: state.obsCrossfilter,
  layoutChoice: state.layoutChoice,
  isSubsetted: state.controls.isSubsetted,
  hostedMode: state.controls.hostedMode,
  userLoggedIn: state.controls.userInfo ? true : false
}))
class Reembedding extends React.PureComponent {
  constructor(props) {
    super(props);
    this.state = {
      setReembedDialogActive: false,
      embName: "",
      reembeddingPanel: false,
    };
  }

  handleEnableReembedDialog = () => {
    this.setState({ setReembedDialogActive: true });
  };

  handleDisableReembedDialog = () => {
    this.setState({
      setReembedDialogActive: false,
    });
  };
  handleRunAndDisablePreprocessingDialog = () => {
    const { dispatch, reembedParams } = this.props;
    
    dispatch(actions.requestPreprocessing(reembedParams));
    this.setState({
      setReembedDialogActive: false,
    });
    // this is where you need to trigger subset if cells were filtered.
  };
  handleRunAndDisableReembedDialog = () => {
    const { dispatch, reembedParams, layoutChoice, obsCrossfilter, isSubsetted } = this.props;
    const { embName } = this.state
    let parentName;

    if (obsCrossfilter.countSelected() === obsCrossfilter.annoMatrix.nObs && isSubsetted) {
      parentName = layoutChoice.current;
    } else if (obsCrossfilter.countSelected() === obsCrossfilter.annoMatrix.nObs) {
      if (layoutChoice.current.includes(";;")){
        parentName = layoutChoice.current.split(";;")
        parentName.pop()
        parentName = parentName.join(';;');
        if (!layoutChoice.available.includes(parentName)){
          parentName="";
        }
      } else{
        parentName="";
      }
    } else {
      parentName = layoutChoice.current;
    }
    dispatch(actions.requestReembed(reembedParams,parentName, embName));
    this.setState({
      setReembedDialogActive: false,
      embName: ""
    });
    // this is where you need to trigger subset if cells were filtered.
  };
  onNameChange = (name) => {
    this.setState({embName: name.target.value})
  }
  render() {
    const { setReembedDialogActive, embName, reembeddingPanel } = this.state;
    const { reembedController, idhash, annoMatrix, obsCrossfilter, preprocessController, reembedParams, hostedMode, userLoggedIn } = this.props;
    const loading = !!reembedController?.pendingFetch || !!preprocessController?.pendingFetch;
    const tipContent =
      "Click to perform preprocessing and dimensionality reduction on the currently selected cells.";
    const title = (reembeddingPanel ? `Reembedding on ${obsCrossfilter.countSelected()}/${annoMatrix.schema.dataframe.nObs} cells.` :
                  "Preprocessing");
    return (
      <div>
        <Dialog
          icon="info-sign"
          onClose={this.handleDisableReembedDialog}
          title={title}
          autoFocus
          canEscapeKeyClose
          canOutsideClickClose
          enforceFocus
          initialStepIndex={0}
          isOpen={setReembedDialogActive}
          usePortal
        >        
          <ControlGroup fill={true} vertical={false}>
            <AnchorButton
              onClick={() => {
                this.setState({...this.state, reembeddingPanel: false})
                }
              } 
              text={`Preprocessing`}
              intent={!reembeddingPanel ? "primary" : null}
            />           
            <AnchorButton
              onClick={() => {
                this.setState({...this.state, reembeddingPanel: true})
              }}
              text={`Reembedding`}
              intent={reembeddingPanel ? "primary" : null}
            />                         
          </ControlGroup>         
          {!reembeddingPanel ? <div style={{
            paddingTop: "20px",
            marginLeft: "10px",
            marginRight: "10px"
          }}>
            <PrepPanel idhash={idhash} />
            <ControlGroup style={{paddingTop: "15px"}} fill={true} vertical={false}>
              <Button onClick={this.handleDisableReembedDialog}>Close</Button>
              {hostedMode ? null : <Button disabled={reembedParams.doBatchPrep && (reembedParams.batchPrepKey==="" || reembedParams.batchPrepLabel === "")}
                      onClick={this.handleRunAndDisablePreprocessingDialog} intent="primary"> Preprocess </Button>}
            </ControlGroup>            
          </div>
          :
          <div style={{
            paddingTop: "20px",
            marginLeft: "10px",
            marginRight: "10px"
          }}>        
            <DimredPanel embName={embName} onChange={this.onNameChange} idhash={idhash} />
            <ControlGroup style={{paddingTop: "15px"}} fill={true} vertical={false}>
                <Button onClick={this.handleDisableReembedDialog}>Close</Button>
                <Button disabled={reembedParams.doBatch && reembedParams.batchKey===""} onClick={this.handleRunAndDisableReembedDialog} intent="primary"> {hostedMode ? "Preprocess and run" : "Run"} </Button>                 
            </ControlGroup>            
          </div>}
        </Dialog>
        <Tooltip
          content={tipContent}
          position="bottom"
          hoverOpenDelay={globals.tooltipHoverOpenDelay}
        >
          <AnchorButton
            icon="new-object"
            loading={loading}
            disabled={!userLoggedIn}
            onClick={this.handleEnableReembedDialog}
            data-testid="reembedding-options"
          />
        </Tooltip>
      </div>
    );
  }
}

export default Reembedding;
