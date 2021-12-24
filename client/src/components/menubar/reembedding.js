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
    const { reembedController, idhash, annoMatrix, obsCrossfilter, preprocessController, reembedParams, userLoggedIn } = this.props;
    const loading = !!reembedController?.pendingFetch || !!preprocessController?.pendingFetch;
    const tipContent =
      "Click to perform preprocessing and dimensionality reduction on the currently selected cells.";
    const cS = obsCrossfilter.countSelected();
    
    const runDisabled = cS > 50000;
    
    const title = `${reembeddingPanel ? "Reembedding" : "Preprocessing"} on ${cS}/${annoMatrix.schema.dataframe.nObs} cells.`;
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
          {runDisabled ? <div style={{paddingBottom: "20px"}}><AnchorButton fill minimal icon="warning-sign" intent="danger"> You cannot preprocess or reembed on greater than 50,000 cells. </AnchorButton></div> : null}
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
              <Button onClick={()=>{this.setState({...this.state, reembeddingPanel: true})}}>Next</Button>
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
                <Button disabled={reembedParams.doBatch && reembedParams.batchKey==="" || 
                                  reembedParams.doBatchPrep && (reembedParams.batchPrepKey==="" || 
                                  reembedParams.batchPrepLabel === "") || runDisabled
                } onClick={this.handleRunAndDisableReembedDialog} intent="primary"> Preprocess and run </Button>                 
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
