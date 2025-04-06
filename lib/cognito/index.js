"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LeoPlatform = void 0;
/* eslint-disable @typescript-eslint/naming-convention */
const cloudformation_include_1 = require("aws-cdk-lib/cloudformation-include");
const constructs_1 = require("constructs");
const path = require("path");
class LeoPlatform extends constructs_1.Construct {
    constructor(scope, id, props) {
        super(scope, id);
        const templateFile = path.resolve(props.templateFile ??
            "node_modules/leo-cdk-lib/lib/platform/cloudformation.json");
        new cloudformation_include_1.CfnInclude(this, "Platform", {
            preserveLogicalIds: false,
            templateFile,
            parameters: {
                ...props.baseParameters,
                ...props.parameterGroups.lambdaProps,
                ...props.parameterGroups.leoArchiveProps,
                ...props.parameterGroups.leoCronProps,
                ...props.parameterGroups.leoEventProps,
                ...props.parameterGroups.leoSettingsProps,
                ...props.parameterGroups.leoStreamProps,
                ...props.parameterGroups.leoSystemProps,
            },
        });
    }
}
exports.LeoPlatform = LeoPlatform;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSx5REFBeUQ7QUFDekQsK0VBQWdFO0FBQ2hFLDJDQUFtRDtBQUVuRCw2QkFBNkI7QUFFN0IsTUFBYSxXQUFZLFNBQVEsc0JBQVM7SUFDeEMsWUFBWSxLQUFpQixFQUFFLEVBQVUsRUFBRSxLQUF1QjtRQUNoRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRWpCLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxPQUFPLENBQy9CLEtBQUssQ0FBQyxZQUFZO1lBQ2hCLDJEQUEyRCxDQUM5RCxDQUFDO1FBRUYsSUFBSSxtQ0FBVSxDQUFDLElBQUksRUFBRSxVQUFVLEVBQUU7WUFDL0Isa0JBQWtCLEVBQUUsS0FBSztZQUN6QixZQUFZO1lBQ1osVUFBVSxFQUFFO2dCQUNWLEdBQUcsS0FBSyxDQUFDLGNBQWM7Z0JBQ3ZCLEdBQUcsS0FBSyxDQUFDLGVBQWUsQ0FBQyxXQUFXO2dCQUNwQyxHQUFHLEtBQUssQ0FBQyxlQUFlLENBQUMsZUFBZTtnQkFDeEMsR0FBRyxLQUFLLENBQUMsZUFBZSxDQUFDLFlBQVk7Z0JBQ3JDLEdBQUcsS0FBSyxDQUFDLGVBQWUsQ0FBQyxhQUFhO2dCQUN0QyxHQUFHLEtBQUssQ0FBQyxlQUFlLENBQUMsZ0JBQWdCO2dCQUN6QyxHQUFHLEtBQUssQ0FBQyxlQUFlLENBQUMsY0FBYztnQkFDdkMsR0FBRyxLQUFLLENBQUMsZUFBZSxDQUFDLGNBQWM7YUFDeEM7U0FDRixDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUF4QkQsa0NBd0JDIiwic291cmNlc0NvbnRlbnQiOlsiLyogZXNsaW50LWRpc2FibGUgQHR5cGVzY3JpcHQtZXNsaW50L25hbWluZy1jb252ZW50aW9uICovXG5pbXBvcnQgeyBDZm5JbmNsdWRlIH0gZnJvbSBcImF3cy1jZGstbGliL2Nsb3VkZm9ybWF0aW9uLWluY2x1ZGVcIjtcbmltcG9ydCB7IENvbnN0cnVjdCwgSUNvbnN0cnVjdCB9IGZyb20gXCJjb25zdHJ1Y3RzXCI7XG5pbXBvcnQgeyBMZW9QbGF0Zm9ybVByb3BzIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gXCJwYXRoXCI7XG5cbmV4cG9ydCBjbGFzcyBMZW9QbGF0Zm9ybSBleHRlbmRzIENvbnN0cnVjdCB7XG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBJQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogTGVvUGxhdGZvcm1Qcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCk7XG5cbiAgICBjb25zdCB0ZW1wbGF0ZUZpbGUgPSBwYXRoLnJlc29sdmUoXG4gICAgICBwcm9wcy50ZW1wbGF0ZUZpbGUgPz9cbiAgICAgICAgXCJub2RlX21vZHVsZXMvbGVvLWNkay1saWIvbGliL3BsYXRmb3JtL2Nsb3VkZm9ybWF0aW9uLmpzb25cIlxuICAgICk7XG5cbiAgICBuZXcgQ2ZuSW5jbHVkZSh0aGlzLCBcIlBsYXRmb3JtXCIsIHtcbiAgICAgIHByZXNlcnZlTG9naWNhbElkczogZmFsc2UsXG4gICAgICB0ZW1wbGF0ZUZpbGUsXG4gICAgICBwYXJhbWV0ZXJzOiB7XG4gICAgICAgIC4uLnByb3BzLmJhc2VQYXJhbWV0ZXJzLFxuICAgICAgICAuLi5wcm9wcy5wYXJhbWV0ZXJHcm91cHMubGFtYmRhUHJvcHMsXG4gICAgICAgIC4uLnByb3BzLnBhcmFtZXRlckdyb3Vwcy5sZW9BcmNoaXZlUHJvcHMsXG4gICAgICAgIC4uLnByb3BzLnBhcmFtZXRlckdyb3Vwcy5sZW9Dcm9uUHJvcHMsXG4gICAgICAgIC4uLnByb3BzLnBhcmFtZXRlckdyb3Vwcy5sZW9FdmVudFByb3BzLFxuICAgICAgICAuLi5wcm9wcy5wYXJhbWV0ZXJHcm91cHMubGVvU2V0dGluZ3NQcm9wcyxcbiAgICAgICAgLi4ucHJvcHMucGFyYW1ldGVyR3JvdXBzLmxlb1N0cmVhbVByb3BzLFxuICAgICAgICAuLi5wcm9wcy5wYXJhbWV0ZXJHcm91cHMubGVvU3lzdGVtUHJvcHMsXG4gICAgICB9LFxuICAgIH0pO1xuICB9XG59XG4iXX0=