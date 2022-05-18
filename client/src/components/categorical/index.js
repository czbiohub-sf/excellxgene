import React from "react";
import { AnchorButton, Tooltip, Position, NumericInput, Collapse, H4 } from "@blueprintjs/core";
import { connect } from "react-redux";
import * as globals from "../../globals";
import Category from "./category";
import { AnnotationsHelpers, ControlsHelpers } from "../../util/stateManager";
import AnnoDialog from "../annoDialog";
import AnnoSelect from "./annoSelect";
import LabelInput from "../labelInput";
import { labelPrompt } from "./labelUtil";
import actions from "../../actions";

@connect((state) => ({
  annoMatrix: state.annoMatrix,
  writableCategoriesEnabled: state.config?.parameters?.annotations ?? false,
  schema: state.annoMatrix?.schema,
  ontology: state.ontology,
  userInfo: state.userInfo,
  resolution: state.Leiden.res,
  layoutChoice: state.layoutChoice,
  obsCrossfilter: state.obsCrossfilter,
  leidenController: state.leidenController,
  refresher: state.sankeySelection.refresher,
  numChecked: state.sankeySelection.numChecked,
  layoutChoice: state.layoutChoice,
  userLoggedIn: state.controls.userInfo ? true : false,
}))
class Categories extends React.Component {
  constructor(props) {
    super(props);
    const { resolution } = props
    this.state = {
      createAnnoModeActive: false,
      newCategoryText: "",
      categoryToDuplicate: null,
      expandedCats: new Set(),
      value: resolution,
      deleteEnabled: false,
      fuseEnabled: false,
      leidenOpen: true,
      catsOpen: true,
    };
  }
  clamp = (num, min=Number.POSITIVE_INFINITY, max=Number.NEGATIVE_INFINITY) => {
    return Math.min(Math.max(num, min), max);
  }
  handleCreateUserAnno = (e) => {
    const { dispatch } = this.props;
    const { newCategoryText, categoryToDuplicate } = this.state;
    dispatch(
      actions.annotationCreateCategoryAction(
        newCategoryText,
        categoryToDuplicate
      )
    );
    this.setState({
      createAnnoModeActive: false,
      categoryToDuplicate: null,
      newCategoryText: "",
    });
    e.preventDefault();
  };

  componentDidUpdate(prevProps) {
    const { refresher, numChecked } = this.props;
    if (refresher !== prevProps.refresher) {
      this.setState({deleteEnabled: numChecked>0, fuseEnabled: numChecked>1})
    }
  }
  handleEnableAnnoMode = () => {
    this.setState({ createAnnoModeActive: true });
  };
  handleLeidenClustering = () => {
    const { dispatch } = this.props
    dispatch(actions.requestLeiden())
  };
  handleDisableAnnoMode = () => {
    this.setState({
      createAnnoModeActive: false,
      categoryToDuplicate: null,
      newCategoryText: "",
    });
  };

  handleModalDuplicateCategorySelection = (d) => {
    this.setState({ categoryToDuplicate: d });
  };

  categoryNameError = (name) => {
    /*
    return false if this is a LEGAL/acceptable category name or NULL/empty string,
    or return an error type.
    */

    /* allow empty string */
    if (name === "") return false;

    /*
    test for uniqueness against *all* annotation names, not just the subset
    we render as categorical.
    */
    const { schema } = this.props;
    const allCategoryNames = schema.annotations.obs.columns.map((c) => c.name);
    /* check category name syntax */
    const error = AnnotationsHelpers.annotationNameIsErroneous(name);
    if (error) {
      return error;
    }

    /* disallow duplicates */
    if (allCategoryNames.indexOf(name) !== -1) {
      return "duplicate";
    }

    /* otherwise, no error */
    return false;
  };

  handleChange = (name) => {
    this.setState({ newCategoryText: name });
  };

  handleSelect = (name) => {
    this.setState({ newCategoryText: name });
  };

  handleFuseLabels = () => {
    const { dispatch } = this.props
    dispatch(actions.requestFuseLabels())
  };  

  handleDeleteLabels = () => {
    const { dispatch } = this.props
    dispatch(actions.requestDeleteLabels())
  };  

  instruction = (name) => {
    return labelPrompt(
      this.categoryNameError(name),
      "New, unique category name",
      ":"
    );
  };

  onExpansionChange = (catName) => {
    const { expandedCats } = this.state;
    if (expandedCats.has(catName)) {
      const _expandedCats = new Set(expandedCats);
      _expandedCats.delete(catName);
      this.setState({ expandedCats: _expandedCats });
    } else {
      const _expandedCats = new Set(expandedCats);
      _expandedCats.add(catName);
      this.setState({ expandedCats: _expandedCats });
    }
  };
  handleSaveMetadata = () => {
    const { dispatch } = this.props;
    dispatch(actions.downloadMetadata())
  }  

  render() {
    const {
      createAnnoModeActive,
      categoryToDuplicate,
      newCategoryText,
      expandedCats,
      value,
      deleteEnabled,
      fuseEnabled,
      leidenOpen,
      catsOpen,
    } = this.state;
    const {
      schema,
      ontology,
      userInfo,
      leidenController,
      dispatch,
      layoutChoice,
      userLoggedIn,
      leftSidebarWidth,
    } = this.props;
    const ontologyEnabled = ontology?.enabled ?? false;
    const loading = !!leidenController?.pendingFetch;// || !!reembedController?.pendingFetch || !!preprocessController?.pendingFetch;
    /* all names, sorted in display order.  Will be rendered in this order */
    const allCategoryNames = ControlsHelpers.selectableCategoryNames(
      schema
    ).sort();
    return (
        <div
          style={{
            padding: globals.leftSidebarSectionPadding,
          }}
        >
          <AnnoDialog
            isActive={createAnnoModeActive}
            title="Create new category"
            instruction={this.instruction(newCategoryText)}
            cancelTooltipContent="Close this dialog without creating a category."
            primaryButtonText="Create new category"
            primaryButtonProps={{ "data-testid": "submit-category" }}
            text={newCategoryText}
            validationError={this.categoryNameError(newCategoryText)}
            handleSubmit={this.handleCreateUserAnno}
            handleCancel={this.handleDisableAnnoMode}
            annoInput={
              <LabelInput
                labelSuggestions={ontologyEnabled ? ontology.terms : null}
                onChange={this.handleChange}
                onSelect={this.handleSelect}
                inputProps={{
                  "data-testid": "new-category-name",
                  leftIcon: "tag",
                  intent: "none",
                  autoFocus: true,
                }}
                newLabelMessage="New category"
              />
            }
            annoSelect={
              <AnnoSelect
                handleModalDuplicateCategorySelection={
                  this.handleModalDuplicateCategorySelection
                }
                categoryToDuplicate={categoryToDuplicate}
                allCategoryNames={allCategoryNames}
              />
            }
          />
          
          {userLoggedIn && (
            <div style={{display: "flex", flexDirection: "column"}}>

              {userLoggedIn && <div  style={{
                display: 'inline-flex',
                justifyContent: 'space-between',
                margin: '0 0',
                marginBottom: 10,
                columnGap: "5px"
              }}>               
                <Tooltip
                  content={
                    userInfo.is_authenticated
                      ? "Create a new category"
                      : "You must be logged in to create new categorical fields"
                  }
                  position={Position.RIGHT}
                  boundary="viewport"
                  hoverOpenDelay={globals.tooltipHoverOpenDelay}
                  modifiers={{
                    preventOverflow: { enabled: false },
                    hide: { enabled: false },
                  }}
                >
                  <AnchorButton
                    type="button"
                    data-testid="open-annotation-dialog"
                    onClick={this.handleEnableAnnoMode}
                    intent="primary"
                    disabled={!userInfo.is_authenticated || !userLoggedIn}
                  >
                    Create new <strong>category</strong>
                  </AnchorButton>
                </Tooltip>
                  <AnchorButton
                    style={{"height":"20px"}}
                    type="button"
                    data-testid="leiden-cluster"
                    onClick={this.handleLeidenClustering}
                    intent="primary"
                    disabled={loading || !userLoggedIn}
                  >
                    <strong>Leiden</strong> cluster
                  </AnchorButton>     
                  <Tooltip
                      content="Leiden clustering resolution parameter"
                      position={Position.BOTTOM}
                      boundary="viewport"
                      hoverOpenDelay={globals.tooltipHoverOpenDelay}
                      modifiers={{
                        preventOverflow: { enabled: false },
                        hide: { enabled: false },
                      }}
                    >                       
                      <NumericInput
                        style={{"width":"40px"}}
                        placeholder={value}
                        value={value}
                        onValueChange={
                          (_valueAsNumber, valueAsString) => {
                            let val = valueAsString;
                            dispatch({
                              type: "leiden: set resolution",
                              res: parseFloat(val)
                            })
                            this.setState({value: val})
                          }
                        }
                      />
                  </Tooltip>
                </div> }
                {userLoggedIn && <div  style={{
                  display: 'inline-flex',
                  justifyContent: 'space-between',
                  margin: '0 0',
                  marginBottom: 10,
                  columnGap: "5px"
                }}>
                  <AnchorButton
                    style={{"height":"20px", marginBottom: 10, width: "50%", margin: '0 0',}}
                    type="button"
                    data-testid="fuse-labels"
                    onClick={this.handleFuseLabels}
                    intent="primary"
                    disabled={!fuseEnabled || !userLoggedIn}
                  >
                    <strong>Fuse</strong> labels
                  </AnchorButton>   
                  <AnchorButton
                    style={{"height":"20px", marginBottom: 10, width: "50%", margin: '0 0',}}
                    type="button"
                    data-testid="delete-labels"
                    onClick={this.handleDeleteLabels}
                    intent="primary"
                    disabled={!deleteEnabled || layoutChoice.sankey || !userLoggedIn}
                  >
                    <strong>Delete</strong> labels
                  </AnchorButton>                     
                </div>}
              </div>            
        )}

        {/* READ ONLY CATEGORICAL FIELDS */}
        {/* this is duplicative but flat, could be abstracted */}
        <AnchorButton
              onClick={() => {
                this.setState({ 
                  leidenOpen: !leidenOpen
                });
              }}
              text={<span><H4>Leiden clustering</H4></span>}
              fill
              minimal
              rightIcon={leidenOpen ? "chevron-down" : "chevron-right"} small
        />               
        <Collapse isOpen={leidenOpen}>
          {allCategoryNames.map((catName) =>
            schema.annotations.obsByName[catName].writable && catName.startsWith('leiden_v') ? (
              <Category
                key={catName}
                metadataField={catName}
                onExpansionChange={this.onExpansionChange}
                isExpanded={expandedCats.has(catName)}
                createAnnoModeActive={createAnnoModeActive}
                leftSidebarWidth={leftSidebarWidth}
              />
            ) : null
          )}
        </Collapse>        
        {/*{allCategoryNames.map((catName) =>
          !schema.annotations.obsByName[catName].writable &&
          (schema.annotations.obsByName[catName].categories?.length > 1 ||
            !schema.annotations.obsByName[catName].categories) && !catName.startsWith('leiden_v') ? (
            <Category
              key={catName}
              metadataField={catName}
              onExpansionChange={this.onExpansionChange}
              isExpanded={expandedCats.has(catName)}
              createAnnoModeActive={createAnnoModeActive}
            />
          ) : null
        )}*/}
        <hr/>
        <AnchorButton
              onClick={() => {
                this.setState({ 
                  catsOpen: !catsOpen
                });
              }}
              text={<span><H4>Categorical</H4></span>}
              fill
              minimal
              rightIcon={catsOpen ? "chevron-down" : "chevron-right"} small
        />          
        {/* WRITEABLE FIELDS */}
        <Collapse isOpen={catsOpen}>
        {allCategoryNames.map((catName) =>
          schema.annotations.obsByName[catName].writable && !catName.startsWith('leiden_v') ? (
            <Category
              key={catName}
              metadataField={catName}
              onExpansionChange={this.onExpansionChange}
              isExpanded={expandedCats.has(catName)}
              createAnnoModeActive={createAnnoModeActive}
              leftSidebarWidth={leftSidebarWidth}
            />
          ) : null
        )}</Collapse>       
      </div>
    );
  }
}

export default Categories;
