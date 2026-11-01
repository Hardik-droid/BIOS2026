package obs

import (
	"github.com/prometheus/client_golang/prometheus"
	"testing"
)

func TestMonitoringNamesRemainCompatible(t *testing.T) {
	registry := prometheus.NewRegistry()
	count := prometheus.NewCounter(prometheus.CounterOpts{Name: "localfirst_example_total", Help: "test metric"})
	registry.MustRegister(count)
	count.Add(3)
	families, err := (compatibleMetrics{registry}).Gather()
	if err != nil {
		t.Fatal(err)
	}
	values := map[string]float64{}
	for _, family := range families {
		values[family.GetName()] = family.Metric[0].GetCounter().GetValue()
	}
	if values["localfirst_example_total"] != 3 || values["diwan_example_total"] != 3 {
		t.Fatal("monitoring compatibility lost")
	}
}
