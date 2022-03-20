import React from "react";
import { connect } from "react-redux";
import Categorical from "../categorical";
import * as globals from "../../globals";
import DynamicScatterplot from "../scatterplot/scatterplot";
import TopLeftLogoAndTitle from "./topLeftLogoAndTitle";
import Continuous from "../continuous/continuous";
import { Button } from "@blueprintjs/core";
import actions from "../../actions";

const UserButton = (props) => {
  const { userInfo } = props;
  return (
    (userInfo ?? false) ? <LogoutButton/> : <LoginButton/>
  );
}

const LoginButton = () => {
  return <Button style={{height: "50%", textAlign: "right", float: "right"}}  
  onClick={() => {
    window.location=`${window.location.origin}/login`
  }}>Log In</Button>;
};

const LogoutButton = () => { 
  return (
    <Button style={{height: "50%", textAlign: "right", float: "right"}} onClick={() => window.location=`${window.location.origin}/logout`}>
      Logout
    </Button>
  );
};

const ResetPoolButton = (props) => { 
  return (
    <Button style={{height: "50%", textAlign: "left", float: "left"}} onClick={() => props.dispatch(actions.resetPools())}>
      Reset Pools
    </Button>
  );
};

const Profile = (props) => {
  const { dispatch, userInfo } = props;
  return (
    (userInfo ?? false) && (
      <div style={{
        float: "left"
      }}>
        <h2>{userInfo.name}</h2>
        <p>{userInfo.email}</p>
        {(userInfo.email ==="alexander.tarashansky@czbiohub.org") && <ResetPoolButton dispatch={dispatch}/>}
      </div>
    )
  );
};
@connect((state) => ({
  scatterplotXXaccessor: state.controls.scatterplotXXaccessor,
  scatterplotYYaccessor: state.controls.scatterplotYYaccessor,
  userInfo: state.controls.userInfo,
  hostedMode: state.controls.hostedMode
}))
class LeftSideBar extends React.Component {
  render() {
    const { dispatch, scatterplotXXaccessor, scatterplotYYaccessor, userInfo, hostedMode, leftWidth } = this.props;
    const width = leftWidth < globals.leftSidebarWidth ? globals.leftSidebarWidth : "inherit";
    return (
      <div
        style={{
          /* x y blur spread color */
          display: "flex",
          flexDirection: "column",
          height: "100%",
        }}
      >
        <TopLeftLogoAndTitle />
        {hostedMode ? 
        <div style={{
          textAlign: "right",
          float: "right",
          width: width,
          padding: globals.leftSidebarSectionPadding

        }}>
          <Profile userInfo={userInfo} dispatch={dispatch}/>
          <UserButton userInfo={userInfo}/>
        </div> : null}
        <div
          style={{
            height: "100%",
            width: width,
            overflowY: "auto",
          }}
        >
          <Categorical leftSidebarWidth={leftWidth}/>
          <Continuous leftSidebarWidth={leftWidth}/>
        </div>
        {scatterplotXXaccessor && scatterplotYYaccessor ? (
          <DynamicScatterplot />
        ) : null}
      </div>
    );
  }
}

export default LeftSideBar;
