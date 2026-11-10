package httpapi

import "injast/hadaf/internal/domain"

type goalDTO struct {
	ID            string               `json:"id"`
	Name          string               `json:"name"`
	TargetAmount  domain.Money         `json:"targetAmount"`
	SavedAmount   domain.Money         `json:"savedAmount"`
	Deadline      string               `json:"deadline"`
	FundingSource domain.FundingSource `json:"fundingSource"`
	Status        domain.Status        `json:"status"`
	CreatedAt     string               `json:"createdAt"`
}
type walletDTO struct {
	AvailableAmount domain.Money `json:"availableAmount"`
}
type depositDTO struct {
	Goal   goalDTO   `json:"goal"`
	Wallet walletDTO `json:"wallet"`
}
type createDTO struct {
	Name          string               `json:"name"`
	TargetAmount  domain.Money         `json:"targetAmount"`
	Deadline      string               `json:"deadline"`
	FundingSource domain.FundingSource `json:"fundingSource"`
	AcceptedTerms bool                 `json:"acceptedTerms"`
}
type errorDTO struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Field   string `json:"field,omitempty"`
}
