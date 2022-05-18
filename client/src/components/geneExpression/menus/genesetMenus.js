import React from "react";
import { connect } from "react-redux";
import { Tooltip2, Popover2 } from "@blueprintjs/popover2";

import {
  Button,
  AnchorButton,
  Menu,
  MenuItem,
  Popover,
  Position,
  Icon,
  PopoverInteractionKind,
} from "@blueprintjs/core";

import * as globals from "../../../globals";
import actions from "../../../actions";
import AddGeneToGenesetDialogue from "./addGeneToGenesetDialogue";

@connect((state) => {
  return {
    genesetsUI: state.genesetsUI,
    colorAccessor: state.colors.colorAccessor,
    cxgMode: state.controls.cxgMode
  };
})
class GenesetMenus extends React.PureComponent {
  constructor(props) {
    super(props);
    this.state = {popoverOpen: false};
  }

  activateAddGeneToGenesetMode = () => {
    const { dispatch, group, geneset } = this.props;
    dispatch({
      type: "geneset: activate add new genes mode",
      group,
      geneset,
    });
  };

  activateEditGenesetNameMode = () => {
    const { dispatch, group, geneset } = this.props;

    dispatch({
      type: "geneset: activate rename geneset mode",
      group: group,
      name: geneset,
    });
  };

  handleColorByEntireGeneset = () => {
    const { dispatch, group, geneset } = this.props;

    dispatch({
      type: "color by geneset mean expression",
      group,
      geneset,
    });
  };

  handleDeleteCategory = () => {
    const { dispatch, group, geneset } = this.props;
    dispatch(actions.genesetDelete(group, geneset));
  };

  render() {
    const { group, geneset, colorAccessor, histToggler, toggleText, disableToggle, removeHistZeros, writeSort, disableWriteSort,
           diffExp, volcanoClick, selectCellsFromGroup, sortIcon, sortDirection, onSortGenes, varMetadata, volcanoAccessor, activeSelection, isHovered, setMode } = this.props;
    const { popoverOpen } = this.state;
    const isColorBy = `${group}::${geneset}` === colorAccessor;
    // add trash function to the menu if setMode === "genesets"
    return (
      <div id={`genesetMenu-${group}@@${geneset}`} style={{display: "flex", columnGap: 20, justifyContent: "space-between", paddingRight: 30}}>         
            <Tooltip2
              content={`Color by gene set ${geneset} mean of the top 50 genes.`}
              position={Position.BOTTOM_RIGHT}
              hoverOpenDelay={globals.tooltipHoverOpenDelay}
            >
              {(isHovered || popoverOpen) && <AnchorButton
                active={isColorBy}
                intent={isColorBy ? "primary" : "none"}
                style={{padding: 0, minHeight: 0, minWidth: 0}}
                onClick={this.handleColorByEntireGeneset}
                data-testclass="colorby-entire-geneset"
                data-testid={`${group}-${geneset}:colorby-entire-geneset`}
                icon={<Icon icon="tint" iconSize={12} />}
                minimal
              />}
            </Tooltip2>       
            <Popover
              isOpen={popoverOpen}
              onClose={()=>this.setState({popoverOpen: false})}
              interactionKind={PopoverInteractionKind.CLICK}
              boundary="window"
              position={Position.BOTTOM_RIGHT}
              content={
                <div onClick={()=>this.setState({popoverOpen: false})}>
                <Menu>
                  {/*!diffExp && <MenuItem
                    icon="edit"
                    data-testclass="activateEditGenesetNameMode"
                    data-testid={`${group}-${geneset}:edit-genesetName-mode`}
                    onClick={this.activateEditGenesetNameMode}
                    text={`Edit ${cOrG} set name and grouping`}
                  />*/} {/* this should be deleted in favor of double clicking on text and editing it directly*/}
                  <MenuItem
                    icon={"filter-keep"}
                    data-testclass="write-sorting"
                    data-testid={`${group}-${geneset}:write-sorting`}
                    onClick={writeSort}
                    text={"Set default ordering"}
                    disabled={disableWriteSort}
                  />
                  {diffExp && <MenuItem
                    icon={"scatter-plot"}
                    data-testid={`${group}-${geneset}:volcano-plot`}
                    onClick={volcanoClick}
                    text={"Display volcano plot"}
                    active={`${group};;${geneset}`===volcanoAccessor}
                  />}   
                  {diffExp && <MenuItem
                    icon={"polygon-filter"}
                    data-testid={`${group}-${geneset}:group-select`}
                    onClick={selectCellsFromGroup}
                    text={"Select cells assigned to this group"}
                    active={activeSelection}
                  />}    
                  
                  <MenuItem
                    icon={sortIcon}
                    data-testid={`${group}-${geneset}:sort-genes`}
                    onClick={onSortGenes}
                    text={"Sort by the selected var metadata"}
                    active={sortDirection}
                    disabled={varMetadata === "" || !isOpen}
                  />  

                  <MenuItem
                    icon={"vertical-bar-chart-desc"}
                    data-testclass="handleToggleHistZeros"
                    data-testid={`${group}-${geneset}:toggle-hist-zeros`}
                    onClick={histToggler}
                    text={toggleText}
                    disabled={disableToggle}
                    active={removeHistZeros}
                  />                                   
                  {!diffExp && <MenuItem
                    icon="trash"
                    intent="danger"
                    data-testclass="handleDeleteCategory"
                    data-testid={`${group}-${geneset}:delete-category`}
                    onClick={this.handleDeleteCategory}
                    text="Delete this gene set"
                  />}
                </Menu>
                </div>
              }
            >
              {(isHovered || popoverOpen) && <Button
                style={{padding: 0, minHeight: 0, minWidth: 0}}
                data-testclass="seeActions"
                data-testid={`${group}-${geneset}:see-actions`}
                icon={<Icon icon="more" iconSize={12} />}
                small
                minimal
                onClick={()=>this.setState({popoverOpen: !popoverOpen})}
              />}
            </Popover>
            
      </div>
    );
  }
}

export default GenesetMenus;