// Copyright 2016-2018, Pulumi Corporation.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import * as aws from "@pulumi/aws";
import { lambda, s3 } from "@pulumi/aws";
import { Bucket } from "@pulumi/aws/s3";
import * as pulumi from "@pulumi/pulumi";
import { createLambdaFunction, Handler } from "./../function";
import { EventSubscription } from "./../subscription";

/**
 * Arguments to help customize a notification subscription for a bucket.
 */
export interface CommonBucketSubscriptionArgs {
    /**
     * An optional prefix or suffix to filter down notifications.  See
     * aws.s3.BucketNotification.lambdaFunctions for more details.
     */
    filterPrefix?: string;
    filterSuffix?: string;
}

export interface BucketEventSubscriptionArgs extends CommonBucketSubscriptionArgs {
    /**
     * Events to subscribe to. For example: "[s3:ObjectCreated:*]".  Cannot be empty.
     */
    events: string[];
}

/**
 * Arguments to specifically control a subscription to 'ObjectCreated' notifications on a bucket.If
 * more events than just 'ObjectCreated' events are desired, the 'subscribe' function should be used
 * instead.
 */
export interface ObjectCreatedSubscriptionArgs extends CommonBucketSubscriptionArgs {
    // The type of event to listen for.  '*' is the default if not provided.
    event?: "*" | "Put" | "Post" | "Copy" | "CompleteMultipartUpload";
}

/**
 * Arguments to specifically control a subscription to 'ObjectRemoved' notifications on a bucket. If
 * more events than just 'ObjectRemoved' events are desired, the 'subscribe' function should be used
 * instead.
 */
export interface ObjectRemovedSubscriptionArgs extends CommonBucketSubscriptionArgs {
    // The type of event to listen for.  '*' is the default if not provided.
    event?: "*" | "Delete" | "DeleteMarkerCreated";
}

// See https://docs.aws.amazon.com/AmazonS3/latest/dev/notification-content-structure.html.
export interface BucketEvent {
    Records?: BucketRecord[];
}

export interface BucketRecord {
    eventVersion: string;
    eventSource: string;
    awsRegion: string;
    eventTime: string;
    eventName: string;
    userIdentity: {
        principalId: string;
    };
    requestParameters: {
        sourceIPAddress: string;
    };
    responseElements: {
        "x-amz-request-id": string;
        "x-amz-id-2": string;
    };
    s3: {
        s3SchemaVersion: string;
        configurationId: string;
        bucket: {
            name: string;
            ownerIdentity: {
                principalId: string;
            },
            arn: string;
        };
        object: {
            key: string;
            size: number;
            eTag: string;
            versionId?: string;
            sequencer: string;
        };
    };
}


// tslint:disable:max-line-length
export type BucketEventHandler = Handler<BucketEvent, void>;

export function onObjectCreated(
    name: string, bucket: Bucket, handler: BucketEventHandler,
    args?: ObjectCreatedSubscriptionArgs, opts?: pulumi.ResourceOptions): BucketEventSubscription {

    args = args || {};
    args.event = args.event || "*";

    const argsCopy = {
        filterPrefix: args.filterPrefix,
        filterSuffix: args.filterSuffix,
        events: ["s3:ObjectCreated:" + args.event],
    };

    return onEvent(name + "-object-created", bucket, handler, argsCopy, opts);
}

export function onObjectRemoved(
    name: string, bucket: Bucket, handler: BucketEventHandler,
    args?: ObjectRemovedSubscriptionArgs, opts?: pulumi.ResourceOptions): BucketEventSubscription {

    args = args || {};
    args.event = args.event || "*";

    const argsCopy = {
        filterPrefix: args.filterPrefix,
        filterSuffix: args.filterSuffix,
        events: ["s3:ObjectRemoved:" + args.event],
    };

    return onEvent(name + "-object-removed", bucket, handler, argsCopy, opts);
}

const defaultComputePolicies = [
    aws.iam.AWSLambdaFullAccess,                 // Provides wide access to "serverless" services (Dynamo, S3, etc.)
    aws.iam.AmazonEC2ContainerServiceFullAccess, // Required for lambda compute to be able to run Tasks
];

/**
 * Creates a new subscription to the given bucket using the lambda provided, along with optional
 * options to control the behavior of the subscription.  This function should be used when full
 * control over the subscription is wanted, and other helpers (like onPut/onDelete) are not
 * sufficient.
 */
export function onEvent(
    name: string, bucket: Bucket, handler: BucketEventHandler,
    args: BucketEventSubscriptionArgs, opts?: pulumi.ResourceOptions): BucketEventSubscription {

    const func = createLambdaFunction(name + "-bucket-event", handler, opts);
    return new BucketEventSubscription(name, bucket, func, args, opts);
}

interface SubscriptionInfo {
    name: string;
    events: string[];
    filterPrefix?: string;
    filterSuffix?: string;
    lambdaFunctionArn: pulumi.Output<string>;
    permission: aws.lambda.Permission;
}

let bucketSubscriptionInfos = new Map<Bucket, SubscriptionInfo[]>();

/**
 * A component corresponding to a single underlying aws.s3.BucketNotification created for a bucket.
 * Note: due to the AWS requirement that all notifications for a bucket be defined at once, the
 * actual aws.s3.BucketNotification instances will only be created once the pulumi program runs to
 * completion and all subscriptions have been heard about.
 */
export class BucketEventSubscription extends EventSubscription {
    public readonly bucket: pulumi.Output<Bucket>;

    public constructor(
        name: string, bucket: Bucket, func: lambda.Function,
        args: BucketEventSubscriptionArgs, opts?: pulumi.ResourceOptions) {

        super("aws-serverless:bucket:BucketEventSubscription", name, func, { bucket: bucket }, opts);

        const permission = new aws.lambda.Permission(name, {
            function: func,
            action: "lambda:InvokeFunction",
            principal: "s3.amazonaws.com",
            sourceArn: bucket.id.apply(bucketName => `arn:aws:s3:::${bucketName}`),
        }, { parent: this });

        this.permission = permission;

        // We must create only a single BucketNotification per Bucket per AWS API limitations.  See
        // https://github.com/terraform-providers/terraform-provider-aws/issues/1715.  So we push
        // the subscription information here, and then actually create the BucketNotification if
        // needed on process `beforeExit`.
        let subscriptions = bucketSubscriptionInfos.get(bucket);
        if (!subscriptions) {
            subscriptions = [];
            bucketSubscriptionInfos.set(bucket, subscriptions);
        }

        subscriptions.push({
            name: name,
            events: args.events,
            filterPrefix: args.filterPrefix,
            filterSuffix: args.filterSuffix,
            lambdaFunctionArn: func.arn,
            permission: permission,
        });
    }
}

process.on("beforeExit", () => {
    const copy = bucketSubscriptionInfos;

    // Since we are generating more work on the event loop, we will casue `beforeExit` to be invoked again.
    // Make sure to clear out eh pending subscrpitions array so that we don't try to apply them again.

    bucketSubscriptionInfos = new Map();

    for (const [bucket, subscriptions] of copy) {
        const permissions = subscriptions.map(s => s.permission);
        const _ = new aws.s3.BucketNotification(subscriptions[0].name, {
            bucket: bucket.id,
            lambdaFunctions: subscriptions.map(subscription => ({
                events: subscription.events,
                filterPrefix: subscription.filterPrefix,
                filterSuffix: subscription.filterSuffix,
                lambdaFunctionArn: subscription.lambdaFunctionArn,
            })),
        }, { parent: bucket, dependsOn: permissions });
    }
});