export interface Event {
    ResponseURL?: any;
    PhysicalResourceId?: any;
    StackId?: any;
    RequestId?: any;
    LogicalResourceId?: any;
    RequestType?: any;
}
export interface Response {
    Status: string;
    Reason?: string;
    PhysicalResourceId: any;
    StackId: any;
    RequestId: any;
    LogicalResourceId: any;
}
export interface HttpResponse {
    statusCode: string;
    statusMessage: string;
}
export interface Policy {
    name: string;
    statements: any;
}
export interface Identity {
    identity: any;
    policy: Policy | "*";
}
export declare function handler(event: Event, _: any): Promise<void>;
