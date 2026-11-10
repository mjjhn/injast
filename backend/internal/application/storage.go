package application

import "context"

// StorageDiagnostic contains only bounded technical identifiers, never query data.
// DriverCode is an opaque numeric value; application does not import the driver.
type StorageDiagnostic struct {
	Operation  string
	Stage      string
	Kind       string
	DriverCode int
}

type StorageObserver interface {
	StorageFailure(context.Context, StorageDiagnostic)
}

func (e *StorageError) Diagnostic() StorageDiagnostic {
	return StorageDiagnostic{Operation: e.Operation, Stage: e.Stage, Kind: e.Kind, DriverCode: e.DriverCode}
}
