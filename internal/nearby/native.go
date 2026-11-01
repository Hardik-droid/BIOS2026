package nearby

type Device struct {
	Address string `json:"address"`
	Name    string `json:"name"`
}
type Radio struct {
	Available bool   `json:"available"`
	Name      string `json:"name"`
	Error     string `json:"error,omitempty"`
}
