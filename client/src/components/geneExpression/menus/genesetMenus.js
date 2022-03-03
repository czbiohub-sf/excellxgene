import React from "react";
import { connect } from "react-redux";
import { Tooltip2 } from "@blueprintjs/popover2";

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
  };
})
class GenesetMenus extends React.PureComponent {
  constructor(props) {
    super(props);
    this.state = {};
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
    const { group, geneset, genesetsEditable, createText, colorAccessor, histToggler, toggleText, disableToggle, removeHistZeros } = this.props;
    const isColorBy = `${group}::${geneset}` === colorAccessor;

    return (
      <>
        {genesetsEditable && (
          <>
            <Tooltip2
              content={createText}
              position={Position.BOTTOM}
              hoverOpenDelay={globals.tooltipHoverOpenDelay}
            >
              <Button
                style={{ marginLeft: 0, marginRight: 2 }}
                data-testclass="handleAddNewLabelToCategory"
                data-testid={`${group}-${geneset}:add-new-label-to-category`}
                icon={<Icon icon="plus" iconSize={10} />}
                onClick={this.activateAddGeneToGenesetMode}
                small
                minimal
              />
            </Tooltip2>
            <AddGeneToGenesetDialogue group={group} geneset={geneset} />
            <Popover
              interactionKind={PopoverInteractionKind.CLICK}
              boundary="window"
              position={Position.BOTTOM}
              content={
                <Menu>
                  <MenuItem
                    icon="edit"
                    data-testclass="activateEditGenesetNameMode"
                    data-testid={`${group}-${geneset}:edit-genesetName-mode`}
                    onClick={this.activateEditGenesetNameMode}
                    text="Edit gene set name and grouping"
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
                  <MenuItem
                    icon="trash"
                    intent="danger"
                    data-testclass="handleDeleteCategory"
                    data-testid={`${group}-${geneset}:delete-category`}
                    onClick={this.handleDeleteCategory}
                    text="Delete this gene set (destructive, will remove set and collection of genes)"
                  />
                </Menu>
              }
            >
              <Button
                style={{ marginLeft: 0, marginRight: 5 }}
                data-testclass="seeActions"
                data-testid={`${group}-${geneset}:see-actions`}
                icon={<Icon icon="more" iconSize={10} />}
                small
                minimal
              />
            </Popover>
            <Tooltip2
              content={`Color by gene set ${geneset} mean of the top 50 genes.`}
              position={Position.BOTTOM}
              hoverOpenDelay={globals.tooltipHoverOpenDelay}
            >
              <AnchorButton
                active={isColorBy}
                intent={isColorBy ? "primary" : "none"}
                style={{ marginLeft: 0 }}
                onClick={this.handleColorByEntireGeneset}
                data-testclass="colorby-entire-geneset"
                data-testid={`${group}-${geneset}:colorby-entire-geneset`}
                icon={<Icon icon="tint" iconSize={16} />}
              />
            </Tooltip2>
          </>
        )}
      </>
    );
  }
}

export default GenesetMenus;
