package accountdata

import (
	"context"
	"errors"
	"testing"
)

func TestCleanupStripeCustomerAcceptsAmbiguousCommittedJobDeletion(t *testing.T) {
	deleteErr := errors.New("connection lost after commit")
	jobs := &fakeStripeCleanupJobs{
		existing:      true,
		deleteErr:     deleteErr,
		deleteCommits: true,
	}
	stripe := &fakeStripeNeutralizer{}

	if err := cleanupStripeCustomer(context.Background(), jobs, "cus_old", stripe); err != nil {
		t.Fatal(err)
	}
	if jobs.existing {
		t.Fatal("cleanup job still exists after committed deletion")
	}
	if len(stripe.customerIDs) != 1 || stripe.customerIDs[0] != "cus_old" {
		t.Fatalf("neutralized customers = %v, want [cus_old]", stripe.customerIDs)
	}
}

func TestCleanupStripeCustomerAcceptsConcurrentCompletionAfterStripeFailure(t *testing.T) {
	jobs := &fakeStripeCleanupJobs{
		existing:              true,
		removeBeforeRecording: true,
	}
	stripe := &fakeStripeNeutralizer{err: errors.New("Stripe request failed")}

	if err := cleanupStripeCustomer(context.Background(), jobs, "cus_old", stripe); err != nil {
		t.Fatal(err)
	}
	if jobs.existing {
		t.Fatal("cleanup job still exists after concurrent completion")
	}
}

func TestCleanupStripeCustomerRejectsMissingJobWithoutCallingStripe(t *testing.T) {
	jobs := &fakeStripeCleanupJobs{}
	stripe := &fakeStripeNeutralizer{}

	err := cleanupStripeCustomer(context.Background(), jobs, "cus_typo", stripe)
	if !errors.Is(err, ErrStripeCleanupNotPending) {
		t.Fatalf("cleanup error = %v, want ErrStripeCleanupNotPending", err)
	}
	if len(stripe.customerIDs) != 0 {
		t.Fatalf("neutralized customers = %v, want none", stripe.customerIDs)
	}
}

type fakeStripeCleanupJobs struct {
	existing              bool
	deleteErr             error
	deleteCommits         bool
	removeBeforeRecording bool
}

func (f *fakeStripeCleanupJobs) customerForEmail(context.Context, string) (string, error) {
	return "", nil
}

func (f *fakeStripeCleanupJobs) exists(context.Context, string) (bool, error) {
	return f.existing, nil
}

func (f *fakeStripeCleanupJobs) recordFailure(context.Context, string, error) (bool, error) {
	if f.removeBeforeRecording {
		f.existing = false
		return false, nil
	}
	return f.existing, nil
}

func (f *fakeStripeCleanupJobs) delete(context.Context, string) error {
	if f.deleteErr == nil || f.deleteCommits {
		f.existing = false
	}
	return f.deleteErr
}
