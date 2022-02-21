import React from "react";
import * as globals from "../../globals";

const MIN_WIDTH = 150;
class Layout extends React.Component {
  /*
    Layout - this react component contains all the layout style and logic for the application once it has loaded.

    The layout is based on CSS grid: the left and right sidebars have fixed widths, the graph in the middle takes the
    remaining space.

    Note, the renderGraph child is a function rather than a fully-instantiated element because the middle pane of the
    app is dynamically-sized. It must have access to the containing viewport in order to know how large the graph
    should be.
  */
  constructor (props) {
    super(props);
    this.state = {
      dragging: false,
      separatorXPosition: undefined,
      leftWidth: globals.leftSidebarWidth,
      dragging2: false,
      separatorXPosition2: undefined,
      rightWidth: globals.rightSidebarWidth,      
    }
  }

  onMouseDown = (e) => {
    this.setState({
      separatorXPosition: e.clientX,
      dragging: true
    })
  };

  onMouseDown2 = (e) => {
    this.setState({
      separatorXPosition2: e.clientX,
      dragging2: true
    })
  };

  onMove = (clientX) => {
    const { dragging, leftWidth, separatorXPosition,
            dragging2, rightWidth, separatorXPosition2 } = this.state;

    if (dragging && leftWidth && separatorXPosition) {
      const newLeftWidth = leftWidth + clientX - separatorXPosition;

      if (newLeftWidth < MIN_WIDTH) {
        this.setState({
          leftWidth: MIN_WIDTH,
          separatorXPosition: clientX
        })
        return;
      }
      this.setState({
        leftWidth: newLeftWidth,
        separatorXPosition: clientX
      })
    }

    if (dragging2 && rightWidth && separatorXPosition2) {
      const newRightWidth = rightWidth - clientX + separatorXPosition2;

      if (newRightWidth < MIN_WIDTH) {
        this.setState({
          rightWidth: MIN_WIDTH,
          separatorXPosition2: clientX
        })
        return;
      }
      this.setState({
        rightWidth: newRightWidth,
        separatorXPosition2: clientX
      })
    }    
  };

  onMouseMove = (e) => {
    e.preventDefault();
    this.onMove(e.clientX);
  };

  onMouseUp = () => {
    this.setState({
      dragging: false,
      dragging2: false
    })
  };
  


  componentDidMount() {
    /*
      This is a bit of a hack. In order for the graph to size correctly, it needs to know the size of the parent
      viewport. Unfortunately, it can only do this once the parent div has been rendered, so we need to render twice.
    */
    this.forceUpdate();
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("mouseup", this.onMouseUp);    
  }
  componentWillUnmount() {
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("mouseup", this.onMouseUp);    
  }
  render() {
    const { children } = this.props;
    const { leftWidth, rightWidth } = this.state;
    const [leftSidebar, renderGraph, rightSidebar] = children;
    //console.log(window.innerWidth - leftWidth - rightWidth)
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `
          [left-sidebar-start] ${leftWidth + 1}px
          [left-sidebar-end divider-start] 10px
          [divider-end graph-start] auto
          [graph-end divider2-start] 10px
          [divider2-end right-sidebar-start]          
          ${
            rightWidth + 1
          }px [right-sidebar-end]
        `,
          gridTemplateRows: "[top] auto [bottom]",
          gridTemplateAreas: "left-sidebar | divider | graph | divider2 | right-sidebar",
          columnGap: "0px",
          justifyItems: "stretch",
          alignItems: "stretch",
          height: "inherit",
          width: "inherit",
          position: "relative",
          top: 0,
          left: 0,
          minWidth: "1240px",
        }}
      >
        <div
          style={{
            gridArea: "top / left-sidebar-start / bottom / left-sidebar-end",
            position: "relative",
            height: "inherit",
            overflowX: "auto",
            overflowY: "auto"         
          }}
        >
          {React.cloneElement(leftSidebar,{...leftSidebar.props, leftWidth})}
        </div>
        <div
          style={{
              gridArea: "top / divider-start / bottom / divider-end",
              cursor: "col-resize",
              alignSelf: "stretch",
              display: "flex",
              borderLeft: `1px solid ${globals.lightGrey}`,              
              alignItems: "center",
              zIndex: 0                
          }}
          onMouseDown={this.onMouseDown}
        />
        <div
          style={{
            zIndex: 0,
            gridArea: "top / graph-start / bottom / graph-end",
            position: "relative",
            height: "inherit",
          }}
          ref={(ref) => {
            this.viewportRef = ref;
          }}
        >
          {this.viewportRef ? renderGraph(this.viewportRef) : null}
        </div>
        <div
          style={{
              gridArea: "top / divider2-start / bottom / divider2-end",
              cursor: "col-resize",
              alignSelf: "stretch",
              display: "flex",
              alignItems: "center",
              borderRight: `1px solid ${globals.lightGrey}`,              
              zIndex: 0              
          }}
          onMouseDown={this.onMouseDown2}
        />        
        <div
          style={{
            gridArea: "top / right-sidebar-start / bottom / right-sidebar-end",
            position: "relative",
            height: "inherit",
            overflowY: "auto",
            overflowX: "auto"
          }}
        >
          {React.cloneElement(rightSidebar,{...rightSidebar.props, rightWidth})}
        </div>
      </div>
    );
  }
}

export default Layout;
