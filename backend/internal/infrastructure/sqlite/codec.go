package sqlite

import (
	"encoding/json"
	"injast/hadaf/internal/domain"
)

// Storage version 1 used this JSON layout. It remains a persistence detail and
// existing BLOBs are never rewritten by migration or replay.
type persistedGoal struct {
	ID            string               `json:"id"`
	Name          string               `json:"name"`
	TargetAmount  domain.Money         `json:"targetAmount"`
	SavedAmount   domain.Money         `json:"savedAmount"`
	Deadline      string               `json:"deadline"`
	FundingSource domain.FundingSource `json:"fundingSource"`
	Status        domain.Status        `json:"status"`
	CreatedAt     string               `json:"createdAt"`
}
type persistedWallet struct {
	AvailableAmount domain.Money `json:"availableAmount"`
}
type snapshot struct {
	Goal   persistedGoal   `json:"goal"`
	Wallet persistedWallet `json:"wallet"`
}

func (s snapshot) domain() domain.DepositResult {
	return domain.DepositResult{Goal: domain.Goal(s.Goal), Wallet: domain.Wallet(s.Wallet)}
}
func encodeSnapshot(result domain.DepositResult) ([]byte, error) {
	return json.Marshal(snapshot{Goal: persistedGoal(result.Goal), Wallet: persistedWallet(result.Wallet)})
}
