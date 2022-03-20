import React from "react";
import { connect } from "react-redux";
import GeneExpression from "../geneExpression";
import DynamicVolcanoPlot from "../volcanoplot/volcanoplot"
import * as globals from "../../globals";

@connect((state) => ({
  scatterplotXXaccessor: state.controls.scatterplotXXaccessor,
  scatterplotYYaccessor: state.controls.scatterplotYYaccessor,
  volcanoAccessor: state.controls.volcanoAccessor
}))
class RightSidebar extends React.Component {
  render() {
    const { rightWidth, volcanoAccessor } = this.props;
    
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
        {volcanoAccessor ? (
          <DynamicVolcanoPlot rightWidth={rightWidth}/>
        ) : null}        
      </div>
    );
  }
}

export default RightSidebar;
