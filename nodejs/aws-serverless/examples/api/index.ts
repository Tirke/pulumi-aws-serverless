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
import * as serverless from "@pulumi/aws-serverless";
import * as pulumi from "@pulumi/pulumi";

const policy: aws.iam.PolicyDocument = {
    "Version": "2012-10-17",
    "Statement": [
        {
            "Action": "sts:AssumeRole",
            "Principal": {
                "Service": "lambda.amazonaws.com",
            },
            "Effect": "Allow",
            "Sid": "",
        },
    ],
};
const role = new aws.iam.Role("mylambda-role", {
    assumeRolePolicy: JSON.stringify(policy),
});
const fullAccess = new aws.iam.RolePolicyAttachment("mylambda-access", {
    role: role,
    policyArn: aws.iam.AWSLambdaFullAccess,
});
const lambda = new aws.lambda.Function("myfunction", {
    code: new pulumi.asset.FileArchive("./afunction"),
    role: role.arn,
    handler: "index.handler",
    runtime: aws.lambda.NodeJS8d10Runtime,
});

const api = new serverless.apigateway.API("myapi", {
    routes: [
        { method: "GET", path: "/a", handler: async (event) => {
            return {
                statusCode: 200,
                body: "<h1>Hello world!</h1>",
            };
        }},
        { method: "GET", path: "/b", handler: lambda },
    ],
});

export const url = api.url;
