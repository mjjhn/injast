package sqlite

import (
	"context"
	"encoding/json"
	"fmt"
	"injast/hadaf/internal/application"
	"injast/hadaf/internal/domain"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"
)

type financialCommand struct {
	Op, ID, Key string
	Amount      domain.Money
}
type financialResult struct {
	Command financialCommand
	Code    string
	Result  domain.DepositResult
}
type workerMessage struct {
	Phase, Path string
	Commands    []financialCommand
	Results     []financialResult
}

func executeFinancial(service *application.Service, commands []financialCommand) []financialResult {
	results := make([]financialResult, len(commands))
	start := make(chan struct{})
	var ready, done sync.WaitGroup
	for i, command := range commands {
		ready.Add(1)
		done.Add(1)
		go func() {
			defer done.Done()
			ready.Done()
			<-start
			r := financialResult{Command: command}
			var err error
			if command.Op == "cancel" {
				_, err = service.Cancel(ctx, command.ID)
			} else {
				var receipt application.Receipt
				receipt, err = service.Deposit(ctx, command.ID, command.Key, command.Amount)
				r.Result = receipt.Result
			}
			if err != nil {
				if business, ok := err.(*domain.Error); ok {
					r.Code = business.Code
				} else {
					r.Code = "UNEXPECTED: " + err.Error()
				}
			}
			results[i] = r
		}()
	}
	ready.Wait()
	close(start)
	done.Wait()
	return results
}

// Only the child processes receive this flag; normal go test discovers a no-op.
func TestFinancialWorker(t *testing.T) {
	if os.Getenv("HADAF_MATRIX_WORKER") != "1" {
		return
	}
	input, output := json.NewDecoder(os.Stdin), json.NewEncoder(os.Stdout)
	var init workerMessage
	if err := input.Decode(&init); err != nil {
		t.Fatal(err)
	}
	s, err := openTest(init.Path, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err = output.Encode(workerMessage{Phase: "ready"}); err != nil {
		t.Fatal(err)
	}
	var gate workerMessage
	if err = input.Decode(&gate); err != nil || gate.Phase != "start" {
		t.Fatal("bad start", err)
	}
	if err = output.Encode(workerMessage{Phase: "done", Results: executeFinancial(s.Service, init.Commands)}); err != nil {
		t.Fatal(err)
	}
}

type financialWorker struct {
	cmd    *exec.Cmd
	input  io.WriteCloser
	output *json.Decoder
	waited bool
}

func startFinancialWorker(t *testing.T, workerCtx context.Context, path string, commands []financialCommand) *financialWorker {
	t.Helper()
	cmd := exec.CommandContext(workerCtx, os.Args[0], "-test.run=^TestFinancialWorker$")
	cmd.Env = append(os.Environ(), "HADAF_MATRIX_WORKER=1")
	input, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	output, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	cmd.Stderr = os.Stderr
	if err = cmd.Start(); err != nil {
		input.Close()
		t.Fatal(err)
	}
	worker := &financialWorker{cmd: cmd, input: input, output: json.NewDecoder(output)}
	t.Cleanup(func() {
		input.Close()
		if !worker.waited {
			cmd.Process.Kill()
			cmd.Wait()
		}
	})
	if err = json.NewEncoder(input).Encode(workerMessage{Path: path, Commands: commands}); err != nil {
		t.Fatal(err)
	}
	var ready workerMessage
	if err = worker.output.Decode(&ready); err != nil || ready.Phase != "ready" {
		t.Fatal("worker not ready", err, ready.Phase)
	}
	return worker
}
func runFinancialProcesses(t *testing.T, path string, commands []financialCommand) []financialResult {
	t.Helper()
	workerCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	halves := [2][]financialCommand{}
	for i, c := range commands {
		halves[i%2] = append(halves[i%2], c)
	}
	workers := []*financialWorker{startFinancialWorker(t, workerCtx, path, halves[0]), startFinancialWorker(t, workerCtx, path, halves[1])}
	// Both stores are open and waiting on stdin before either receives this gate.
	for _, w := range workers {
		if err := json.NewEncoder(w.input).Encode(workerMessage{Phase: "start"}); err != nil {
			t.Fatal(err)
		}
	}
	var results []financialResult
	for _, w := range workers {
		var result workerMessage
		if err := w.output.Decode(&result); err != nil || result.Phase != "done" {
			t.Fatal("worker failed", err, result.Phase)
		}
		results = append(results, result.Results...)
		w.input.Close()
		err := w.cmd.Wait()
		w.waited = true
		if err != nil {
			t.Fatal("worker exit", err)
		}
	}
	return results
}
func runFinancialStores(t *testing.T, a, b *testStoreHandle, commands []financialCommand) []financialResult {
	t.Helper()
	start := make(chan struct{})
	var ready, done sync.WaitGroup
	out := make([]financialResult, len(commands))
	for i, c := range commands {
		ready.Add(1)
		done.Add(1)
		go func() {
			defer done.Done()
			ready.Done()
			<-start
			s := a
			if i%2 == 1 {
				s = b
			}
			out[i] = executeFinancial(s.Service, []financialCommand{c})[0]
		}()
	}
	ready.Wait()
	close(start)
	done.Wait()
	return out
}
func TestFinancialConcurrencyMatrix(t *testing.T) {
	for _, mode := range []string{"two_stores", "two_processes"} {
		for _, scenario := range []string{"same_key", "conflicting_payload", "target_limit", "wallet_limit", "cancel_deposit"} {
			for iteration := 0; iteration < 5; iteration++ {
				t.Run(fmt.Sprintf("%s/%s/%d", mode, scenario, iteration), func(t *testing.T) {
					path := filepath.Join(t.TempDir(), "matrix.db")
					a, err := openTest(path, time.Now)
					if err != nil {
						t.Fatal(err)
					}
					defer a.Close()
					var commands []financialCommand
					switch scenario {
					case "same_key":
						for i := 0; i < 10; i++ {
							commands = append(commands, financialCommand{Op: "deposit", ID: "book", Key: "same", Amount: 1000})
						}
					case "conflicting_payload":
						commands = []financialCommand{{Op: "deposit", ID: "book", Key: "conflict", Amount: 1000}, {Op: "deposit", ID: "trip", Key: "conflict", Amount: 2000}}
					case "target_limit":
						for i := 0; i < 6; i++ {
							commands = append(commands, financialCommand{Op: "deposit", ID: "book", Key: fmt.Sprint(i), Amount: 200000})
						}
					case "wallet_limit":
						for i := 0; i < 6; i++ {
							commands = append(commands, financialCommand{Op: "deposit", ID: "laptop", Key: fmt.Sprint(i), Amount: 5000000})
						}
					case "cancel_deposit":
						commands = []financialCommand{{Op: "deposit", ID: "trip", Key: "race", Amount: 1000}, {Op: "cancel", ID: "trip"}}
					}
					var results []financialResult
					if mode == "two_processes" {
						results = runFinancialProcesses(t, path, commands)
					} else {
						b, err := openTest(path, time.Now)
						if err != nil {
							t.Fatal(err)
						}
						defer b.Close()
						results = runFinancialStores(t, a, b, commands)
					}
					if len(results) != len(commands) {
						t.Fatal("missing results")
					}
					counts := map[string]int{}
					outcomes := map[string]domain.DepositResult{}
					for _, r := range results {
						counts[r.Code]++
						if r.Code == "" && r.Command.Op == "deposit" {
							if old, ok := outcomes[r.Command.Key]; ok && !reflect.DeepEqual(old, r.Result) {
								t.Fatal("same key response changed")
							}
							outcomes[r.Command.Key] = r.Result
							replay, err := a.Service.Deposit(ctx, r.Command.ID, r.Command.Key, r.Command.Amount)
							if err != nil || !replay.Replayed || !reflect.DeepEqual(replay.Result, r.Result) {
								t.Fatal("replay after concurrency/deletion", err)
							}
						}
					}
					switch scenario {
					case "same_key":
						if counts[""] != 10 || balance(t, a) != 24999000 {
							t.Fatal(counts, balance(t, a))
						}
					case "conflicting_payload":
						if counts[""] != 1 || counts["IDEMPOTENCY_CONFLICT"] != 1 {
							t.Fatal(counts)
						}
					case "target_limit":
						if counts[""] != 2 || counts["OVER_TARGET"] != 4 || balance(t, a) != 24600000 {
							t.Fatal(counts, balance(t, a))
						}
					case "wallet_limit":
						if counts[""] != 5 || counts["INSUFFICIENT_BALANCE"] != 1 || balance(t, a) != 0 {
							t.Fatal(counts, balance(t, a))
						}
					case "cancel_deposit":
						if !(counts[""] == 2 || (counts[""] == 1 && counts["NOT_FOUND"] == 1)) || balance(t, a) != 33000000 {
							t.Fatal(counts, balance(t, a))
						}
						if _, err := a.Goal(ctx, "trip"); err == nil {
							t.Fatal("goal not deleted")
						}
					}
					var saved int
					if err := a.db.QueryRow("SELECT COUNT(*) FROM idempotency").Scan(&saved); err != nil || saved != len(outcomes) {
						t.Fatal("outcome reservation", saved, len(outcomes), err)
					}
					if total(t, a) != 54500000 {
						t.Fatal("money invariant", total(t, a))
					}
				})
			}
		}
	}
}
