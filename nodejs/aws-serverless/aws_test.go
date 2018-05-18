package examples

import (
	"fmt"
	"os"
	"path"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/pulumi/pulumi/pkg/testing/integration"
)

// Fargate is only supported in `us-east-1`, so force Fargate-based tests to run there.
const fargateRegion = "us-east-1"

func Test_Examples(t *testing.T) {
	region := os.Getenv("AWS_REGION")
	if region == "" {
		t.Skipf("Skipping test due to missing AWS_REGION environment variable")
	}
	fmt.Printf("AWS Region: %v\n", region)

	cwd, err := os.Getwd()
	if !assert.NoError(t, err, "expected a valid working directory: %v", err) {
		return
	}
	examples := []integration.ProgramTestOptions{
		{
			Dir: path.Join(cwd, "./examples/bucket"),
			Config: map[string]string{
				"aws:region":     region,
				"cloud:provider": "aws",
			},
			Dependencies: []string{
				"@pulumi/aws-infra",
			},
		},
	}
	for _, ex := range examples {
		example := ex.With(integration.ProgramTestOptions{
			ReportStats: integration.NewS3Reporter("us-west-2", "eng.pulumi.com", "testreports"),
			Tracing:     "https://tracing.pulumi-engineering.com/collector/api/v1/spans",
		})
		t.Run(example.Dir, func(t *testing.T) {
			integration.ProgramTest(t, &example)
		})
	}
}
