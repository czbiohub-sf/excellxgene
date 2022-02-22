import React from "react";
import * as globals from "../../globals";
import {
  AnchorButton,
  NumericInput,
  Label,
  Checkbox,
  MenuItem,
  Position,
  Tooltip,
} from "@blueprintjs/core";
import { Select } from "@blueprintjs/select";

class StateParameterInput extends React.PureComponent {
  constructor(props) {
    super(props);
  }

  clamp = (num, min=Number.POSITIVE_INFINITY, max=Number.NEGATIVE_INFINITY) => {
    return Math.min(Math.max(num, min), max);
  };      
  render() {
    const { value, setter, label, min, max, tooltipContent, left } = this.props;    
    switch (typeof value) {
      case "boolean": {
        const { disabled } = this.props;
        return (
          <div>
            <Tooltip
                content={tooltipContent}
                position={Position.BOTTOM}
                boundary="viewport"
                hoverOpenDelay={globals.tooltipHoverOpenDelay}
                modifiers={{
                  preventOverflow: { enabled: false },
                  hide: { enabled: false },
                }}
                targetTagName="span"
                wrapperTagName="span"
              >               
                <Checkbox checked={value} label={label} style={{"paddingTop":"10px"}}
                  onChange={setter} 
                  disabled={disabled}
                /> 
            </Tooltip>
          </div>          
        )
      } case "string": {
        const { disabled, options } = this.props;
        return (
          <div style={{"paddingTop":"5px"}}>
            <Tooltip
              content={tooltipContent}
              position={left ? Position.RIGHT : Position.BOTTOM}
              hoverOpenDelay={globals.tooltipHoverOpenDelay}
              modifiers={{
                preventOverflow: { enabled: false },
                hide: { enabled: false },
              }}
              targetTagName="span"
              wrapperTagName="span"
            >   
              <Select
              disabled={disabled}
              items={
                options
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
              onItemSelect={setter}
            >
              <AnchorButton
                disabled={disabled}
                text={`${label}: ${value}`}
                rightIcon="double-caret-vertical"
              />
            </Select>
          </Tooltip>
        </div>
        );
      } default: {
        const { disabled } = this.props;
        return (
          <Label>
            {label}
            <Tooltip
              content={tooltipContent}
              position={Position.BOTTOM}
              boundary="viewport"
              hoverOpenDelay={globals.tooltipHoverOpenDelay}
              modifiers={{
                preventOverflow: { enabled: false },
                hide: { enabled: false },
              }}
            >               
              <NumericInput
                disabled={disabled}
                allowNumericCharactersOnly={true}
                placeholder={label}
                value={value}
                min={min}
                max={max}
                minorStepSize={1}
                onValueChange={
                  (valueAsNumber) => {
                    setter(valueAsNumber)
                  }
                }
              />
            </Tooltip>
          </Label> 
        );
      }
    }    
  }
}
export default StateParameterInput;
