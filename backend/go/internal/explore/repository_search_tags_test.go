package explore

import (
	"reflect"
	"testing"
)

func TestExtractNormalizedProfilePostHashtags(t *testing.T) {
	t.Parallel()

	tags := extractNormalizedProfilePostHashtags(
		"Aksam rotasi #Bogaz #İstanbul #bogaz #Gece_Surusu",
	)

	expected := []string{"bogaz", "istanbul", "gece_surusu"}
	if !reflect.DeepEqual(tags, expected) {
		t.Fatalf("extractNormalizedProfilePostHashtags() = %#v, want %#v", tags, expected)
	}
}
