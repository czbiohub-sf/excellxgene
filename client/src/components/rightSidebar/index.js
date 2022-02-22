import React from "react";
import { connect } from "react-redux";
import GeneExpression from "../geneExpression";
import * as globals from "../../globals";

@connect((state) => ({
  scatterplotXXaccessor: state.controls.scatterplotXXaccessor,
  scatterplotYYaccessor: state.controls.scatterplotYYaccessor,
}))
class RightSidebar extends React.Component {
  render() {
    const { rightWidth } = this.props;
    
    const width = rightWidth < globals.rightSidebarWidth ? globals.rightSidebarWidth : "inherit";

    return (
      <div
        style={{
          /* x y blur spread color */
          display: "flex",
          flexDirection: "column",
          position: "relative",
          height: "inherit",
          width: width,
          padding: globals.leftSidebarSectionPadding,
        }}
      >
        <GeneExpression rightWidth={rightWidth}/>
      </div>
    );
  }
}

export default RightSidebar;
