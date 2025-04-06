export interface EventBody {
    requestContext: {
        identity: {
            cognitoIdentityId: string;
        };
    };
}
export interface Event {
    body: {
        event: EventBody;
        resource: {
            lrn: string;
        };
        request_id: any;
    };
}
export declare function handler(event: Event, _: any): Promise<{
    authorized: any;
    user: any;
}>;
