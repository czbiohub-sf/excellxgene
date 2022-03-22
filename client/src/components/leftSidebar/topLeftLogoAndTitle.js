import React from "react";
import { connect } from "react-redux";
import { Button, AnchorButton, Tooltip, Dialog } from "@blueprintjs/core";
import * as globals from "../../globals";
import Logo from "../framework/logo";
import Truncate from "../util/truncate";
import InfoDrawer from "../infoDrawer/infoDrawer";
import InformationMenu from "./infoMenu";

const DATASET_TITLE_FONT_SIZE = 14;

@connect((state) => {
  const { corpora_props: corporaProps } = state.config;
  const correctVersion =
    ["1.0.0", "1.1.0"].indexOf(corporaProps?.version?.corpora_schema_version) >
    -1;
  return {
    datasetTitle: state.config?.displayNames?.dataset ?? "",
    libraryVersions: state.config?.library_versions,
    aboutLink: state.config?.links?.["about-dataset"],
    tosURL: state.config?.parameters?.about_legal_tos,
    privacyURL: state.config?.parameters?.about_legal_privacy,
    title: correctVersion ? corporaProps?.title : undefined,
    hostedMode: state.controls.hostedMode,
    prevCrossfilter: state.obsCrossfilter,
    annoMatrix: state.annoMatrix,
    userLoggedIn: state.controls.userInfo ? true : false,
  };
})
class LeftSideBar extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      warningDialog: false
    };
  }

  handleClick = () => {
    const { dispatch } = this.props;
    dispatch({ type: "toggle dataset drawer" });
  };

  render() {
    const {
      datasetTitle,
      libraryVersions,
      aboutLink,
      privacyURL,
      tosURL,
      dispatch,
      title,
      hostedMode,
      prevCrossfilter,
      annoMatrix,
      userLoggedIn
    } = this.props;
    const { warningDialog } = this.state;
    return (
      <div
        style={{
          paddingLeft: 8,
          paddingTop: 8,
          width: globals.leftSidebarWidth,
          zIndex: 1,
          borderBottom: `1px solid ${globals.lighterGrey}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <Logo size={28} />
          <span
            style={{
              fontSize: 24,
              position: "relative",
              top: -6,
              fontWeight: "bold",
              marginLeft: 5,
              color: globals.logoColor,
              userSelect: "none",
            }}
          >
            cell
            <span
              style={{
                position: "relative",
                top: 1,
                fontWeight: 300,
                fontSize: 24,
              }}
            >
              ×
            </span>
            gene
          </span>
        </div>
        <div style={{ marginRight: 5, height: "100%" }}>
          <Button
            minimal
            style={{
              fontSize: DATASET_TITLE_FONT_SIZE,
              position: "relative",
              top: -1,
            }}
            onClick={this.handleClick}
          >
            <Truncate>
              <span style={{ maxWidth: 155 }} data-testid="header">
                {title ?? datasetTitle}
              </span>
            </Truncate>
          </Button>
          <InfoDrawer />
          <InformationMenu
            {...{
              libraryVersions,
              aboutLink,
              tosURL,
              privacyURL,
              dispatch,
            }}
          />
          {hostedMode && userLoggedIn && <><Tooltip
            content="Reset cellxgene to the initial state."
            position="bottom"
            hoverOpenDelay={globals.tooltipHoverOpenDelay}
          >                 
            <AnchorButton
              icon="reset"
              onClick={()=>{this.setState({warningDialog: true})}}
            />
          </Tooltip>
          <Dialog
            title="Warning: all changes will be lost."
            isOpen={warningDialog}
            onClose={()=>{
              this.setState({
                warningDialog: false
              })
            }}
          >
            <div style={{
              display: "flex",
              margin: "0 auto",
              paddingTop: "10px"
            }}>
            <div
            style={{fontSize: "16px", paddingRight: "10px", margin: "auto 0"}}
            >Are you sure you want to reset to the default state?</div>
            <AnchorButton
              type="button"
              intent="danger"
              icon="warning-sign"
              onClick={() => {
                fetch(
                  `${globals.API.prefix}${globals.API.version}resetToRoot`,
                  {
                    method: "PUT",
                    headers: new Headers({
                      Accept: "application/octet-stream",
                      "Content-Type": "application/json",
                    }),
                    credentials: "include",
                    }
                ).then(()=>{
                  window.location.reload()
                })
                this.setState({warningDialog: false})
              }}
            > OK </AnchorButton>         
            </div>
          </Dialog></>}          
        </div>
      </div>
    );
  }
}

export default LeftSideBar;
