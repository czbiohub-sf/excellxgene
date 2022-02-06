import React from "react";
import { connect } from "react-redux";
import * as globals from "../../globals";
import { AnchorButton, Button, Icon, MenuItem, Position, Tooltip, } from "@blueprintjs/core";
import { Select } from "@blueprintjs/select";
import Truncate from "../util/truncate";
import HistogramBrush from "../brushableHistogram";

import actions from "../../actions";

const MINI_HISTOGRAM_WIDTH = 110;

@connect((state, ownProps) => {
  const { gene } = ownProps;

  return {
    var_keys: state.annoMatrix.schema.var_keys,
    isColorAccessor: state.colors.colorAccessor === gene,
    isScatterplotXXaccessor: state.controls.scatterplotXXaccessor === gene,
    isScatterplotYYaccessor: state.controls.scatterplotYYaccessor === gene,
    dataLayerExpr: state.reembedParameters.dataLayerExpr,
    logScaleExpr: state.reembedParameters.logScaleExpr
  };
})
class Gene extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      geneIsExpanded: false,
      geneInfo: "",
      varMetadata: ""
    };
  }

  onColorChangeClick = () => {
    const { dispatch, gene } = this.props;
    dispatch(actions.requestSingleGeneExpressionCountsForColoringPOST(gene));
  };

  handleGeneExpandClick = () => {
    const { geneIsExpanded } = this.state;
    this.setState({ geneIsExpanded: !geneIsExpanded });
  };

  handleSetGeneAsScatterplotX = () => {
    const { dispatch, gene } = this.props;
    dispatch({
      type: "set scatterplot x",
      data: gene,
    });
  };

  handleSetGeneAsScatterplotY = () => {
    const { dispatch, gene } = this.props;
    dispatch({
      type: "set scatterplot y",
      data: gene,
    });
  };

  handleDeleteGeneFromSet = () => {
    const { dispatch, gene, geneset } = this.props;
    dispatch(actions.genesetDeleteGenes(geneset, [gene]));
  };

  render() {
    const {
      dispatch,
      gene,
      geneDescription,
      isColorAccessor,
      isScatterplotXXaccessor,
      isScatterplotYYaccessor,
      removeHistZeros,
      removeGene,
      var_keys,
    } = this.props;
    const { geneIsExpanded, varMetadata, geneInfo } = this.state;
    const geneSymbolWidth = 60 + (geneIsExpanded ? MINI_HISTOGRAM_WIDTH : 0);
    return (
      <div>
        <div
          style={{
            marginLeft: 5,
            marginRight: 0,
            marginTop: 2,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div
            role="menuitem"
            tabIndex="0"
            data-testclass="gene-expand"
            data-testid={`${gene}:gene-expand`}
            onKeyPress={() => {}}
            style={{
              cursor: "pointer",
              display: "flex",
              justifyContent: "space-between",
              width: "100%",
            }}
          >
            <div>
              <Icon
                icon="drag-handle-horizontal"
                iconSize={12}
                style={{
                  marginRight: 7,
                  cursor: "grab",
                  position: "relative",
                  top: -1,
                }}
              />
              <Truncate
                tooltipAddendum={geneDescription && `: ${geneDescription}`}
              >
                <span
                  style={{
                    width: geneSymbolWidth,
                    display: "inline-block",
                  }}
                  data-testid={`${gene}:gene-label`}
                >
                  {gene}
                </span>
              </Truncate>
            </div>
            {!geneIsExpanded ? (
              <HistogramBrush
                isUserDefined
                field={gene}
                mini
                width={MINI_HISTOGRAM_WIDTH}
                removeHistZeros={removeHistZeros}
              />
            ) : null}
          </div>
          <div style={{ flexShrink: 0, marginLeft: 2 }}>
            <Button
              minimal
              small
              data-testid={`delete-from-geneset-${gene}`}
              onClick={removeGene ? removeGene(gene,isColorAccessor,dispatch) : this.handleDeleteGeneFromSet}
              intent="none"
              style={{ fontWeight: 700, marginRight: 2 }}
              icon={<Icon icon="trash" iconSize={10} />}
            />
            <Button
              minimal
              small
              data-testid={`plot-x-${gene}`}
              onClick={this.handleSetGeneAsScatterplotX}
              active={isScatterplotXXaccessor}
              intent={isScatterplotXXaccessor ? "primary" : "none"}
              style={{ fontWeight: 700, marginRight: 2 }}
            >
              x
            </Button>
            <Button
              minimal
              small
              data-testid={`plot-y-${gene}`}
              onClick={this.handleSetGeneAsScatterplotY}
              active={isScatterplotYYaccessor}
              intent={isScatterplotYYaccessor ? "primary" : "none"}
              style={{ fontWeight: 700, marginRight: 2 }}
            >
              y
            </Button>
            <Button
              minimal
              small
              data-testclass="maximize"
              data-testid={`maximize-${gene}`}
              onClick={this.handleGeneExpandClick}
              active={geneIsExpanded}
              intent="none"
              icon={<Icon icon="maximize" iconSize={10} />}
              style={{ marginRight: 2 }}
            />
            <Button
              minimal
              small
              data-testclass="colorby"
              data-testid={`colorby-${gene}`}
              onClick={this.onColorChangeClick}
              active={isColorAccessor}
              intent={isColorAccessor ? "primary" : "none"}
              icon={<Icon icon="tint" iconSize={12} />}
            />
          </div>
        </div>
        {geneIsExpanded && 
          <div style={{
              display: "flex",
              justifyContent: "space-between",
              width: "inherit",
              paddingTop:"5px",
              paddingBotton: "5px"
            }}>
              <Tooltip
                content={"The gene metadata to display."}
                position={Position.BOTTOM}
                hoverOpenDelay={globals.tooltipHoverOpenDelay}
                modifiers={{
                  preventOverflow: { enabled: false },
                  hide: { enabled: false },
                }}
              >   
                <Select
                items={
                  var_keys
                }
                filterable={false}
                itemRenderer={(d, { handleClick }) => {
                  return (
                    <MenuItem
                      onClick={handleClick}
                      key={d}
                      text={d}
                    />
                  );
                }}
                onItemSelect={(d) => {
                  this.setState({
                    ...this.state,
                    varMetadata: d
                  })
                  dispatch(actions.fetchGeneInfo(gene, d)).then((res) => {
                    this.setState({
                      ...this.state,
                      geneInfo: res
                    })
                  })                  
                }}
              >
                <AnchorButton
                  text={`Metadata: ${varMetadata}`}
                  rightIcon="double-caret-vertical"
                />
              </Select>
            </Tooltip>
            <div style={{margin: "auto 0"}}>
            {geneInfo} 
            </div>
            
          </div>}          
 
        {geneIsExpanded && <HistogramBrush isUserDefined field={gene} removeHistZeros={removeHistZeros} />}
      </div>
    );
  }
}

export default Gene;
