/* rc slider https://www.npmjs.com/package/rc-slider */

import React from "react";
import { connect } from "react-redux";
import { AnchorButton, Collapse, H4 } from "@blueprintjs/core"
import HistogramBrush from "../brushableHistogram";
import actions from "../../actions";

@connect((state) => ({
  schema: state.annoMatrix?.schema,
  userLoggedIn: state.controls.userInfo ? true : false
}))
class Continuous extends React.PureComponent {
  constructor(props) {
    super(props);
    this.state = {
      contOpen: true
    };
  }
  render() {
    /* initial value for iterator to simulate index, ranges is an object */
    const { dispatch, schema, userLoggedIn } = this.props;
    const { contOpen } = this.state;
    if (!schema) return null;
    const obsIndex = schema.annotations.obs.index;
    const allContinuousNames = schema.annotations.obs.columns
      .filter((col) => col.type === "int32" || col.type === "float32" || col.type === "float")
      .filter((col) => col.name !== obsIndex)
      .map((col) => col.name);

    return (
      <div>
        <hr/>
        <AnchorButton
              onClick={() => {
                this.setState({ 
                  contOpen: !contOpen
                });
              }}
              text={<span><H4>Continuous</H4></span>}
              fill
              minimal
              rightIcon={contOpen ? "chevron-down" : "chevron-right"} small
        />               
        <Collapse isOpen={contOpen}>
        {allContinuousNames.map((key, zebra) => (
          <HistogramBrush key={key} onRemoveClick={userLoggedIn ? (
            (field)=>{
              dispatch(actions.annotationDeleteCategoryAction(field));              
            }
          ) : null}
          field={key} isObs zebra={zebra % 2 === 0} />
        ))}
        </Collapse>
      </div>
    );
  }
}

export default Continuous;
