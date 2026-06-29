// AWS Lambda entrypoint. Wraps the existing Express app with
// @codegenie/serverless-express so the same routes run behind a Lambda Function
// URL (or API Gateway). The app module guards app.listen on AWS_LAMBDA_FUNCTION_NAME,
// so importing it here does not open a port.
import serverlessExpress from "@codegenie/serverless-express";
import { app } from "./index.js";

export const handler = serverlessExpress({ app });
